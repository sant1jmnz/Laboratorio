import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import * as pty from 'node-pty';
import { prepareProgram } from './build.js';
import { parseMiLine } from './mi-parser.js';

const MAX_CONCURRENT = 3;
const IDLE_TIMEOUT_MS = 10 * 60_000;
const HARD_TIMEOUT_MS = 20 * 60_000;
const CMD_TIMEOUT_MS = 10_000;

let running = 0;
const queue = [];

function acquireSlot() {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot() {
  const next = queue.shift();
  if (next) next(true);
  else running--;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function toInt(v, fallback = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Sesion de depuracion con GDB en modo MI.
 *
 * El programa depurado corre en su PROPIA pty (`-inferior-tty-set`), separada
 * del canal por donde hablamos MI con GDB. Eso es lo que permite que el
 * usuario escriba en la terminal y lo lea `cin`/`scanf` mientras esta
 * pausado en un breakpoint, sin que lo que tipea se confunda con comandos
 * del debugger.
 */
export function handleDebugConnection(ws) {
  let slotAcquired = false;
  let gdb = null;
  let inferiorTty = null; // pty del programa del usuario
  let dir = null;
  let sourceName = null;
  let idleTimer = null;
  let hardTimer = null;
  let closed = false;
  let miBuffer = '';
  let tokenSeq = 0;
  const pending = new Map(); // token -> {resolve, timer}
  const breakpointIds = new Map(); // linea -> id de breakpoint en GDB

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
    for (const { timer, resolve } of pending.values()) {
      clearTimeout(timer);
      resolve({ class: 'error', data: { msg: 'sesion terminada' } });
    }
    pending.clear();
    if (gdb) {
      try { gdb.kill('SIGKILL'); } catch { /* ya murio */ }
      gdb = null;
    }
    if (inferiorTty) {
      try { inferiorTty.kill(); } catch { /* ya murio */ }
      inferiorTty = null;
    }
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    if (slotAcquired) {
      slotAcquired = false;
      releaseSlot();
    }
  };

  const bumpIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send(ws, { type: 'exit', code: null, reason: 'idle' });
      cleanup().then(() => ws.close());
    }, IDLE_TIMEOUT_MS);
  };

  /** Manda un comando MI y espera su respuesta correlacionada por token. */
  function mi(command) {
    if (!gdb) return Promise.resolve({ class: 'error', data: { msg: 'debugger no iniciado' } });
    const token = String(++tokenSeq);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(token);
        resolve({ class: 'error', data: { msg: 'timeout esperando a GDB' } });
      }, CMD_TIMEOUT_MS);
      pending.set(token, { resolve, timer });
      gdb.stdin.write(`${token}${command}\n`);
    });
  }

  /** Junta el estado visible cuando el programa queda pausado y lo manda. */
  async function reportPaused(stopData) {
    const [framesRes, varsRes] = await Promise.all([
      mi('-stack-list-frames'),
      mi('-stack-list-variables --simple-values'),
    ]);

    const frames = (framesRes.data?.stack ?? []).map((f) => ({
      level: toInt(f.level),
      func: f.func ?? '??',
      file: f.file ?? null,
      line: f.line ? toInt(f.line) : null,
    }));

    const variables = (varsRes.data?.variables ?? []).map((v) => ({
      name: v.name,
      value: v.value ?? '(sin valor)',
      isArg: v.arg === '1',
    }));

    const frame = stopData?.frame ?? {};
    send(ws, {
      type: 'paused',
      reason: stopData?.reason ?? 'stopped',
      line: frame.line ? toInt(frame.line) : null,
      func: frame.func ?? null,
      file: frame.file ?? null,
      frames,
      variables,
    });
  }

  function handleMiRecord(rec) {
    if (!rec) return;

    if (rec.kind === 'result' && rec.token) {
      const entry = pending.get(rec.token);
      if (entry) {
        pending.delete(rec.token);
        clearTimeout(entry.timer);
        entry.resolve(rec);
      }
      return;
    }

    if (rec.kind === 'exec') {
      if (rec.class === 'running') {
        send(ws, { type: 'status', status: 'running' });
        return;
      }
      if (rec.class === 'stopped') {
        const reason = rec.data?.reason ?? '';
        if (reason.startsWith('exited')) {
          const code = rec.data['exit-code'] !== undefined ? toInt(rec.data['exit-code']) : 0;
          send(ws, { type: 'exit', code: reason === 'exited-normally' ? 0 : code });
          cleanup().then(() => ws.close());
          return;
        }
        bumpIdle();
        reportPaused(rec.data);
      }
    }
  }

  function onGdbOutput(chunk) {
    miBuffer += chunk.toString();
    const lines = miBuffer.split('\n');
    miBuffer = lines.pop() ?? '';
    for (const line of lines) {
      handleMiRecord(parseMiLine(line));
    }
  }

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'start') {
      if (gdb || dir) return; // una sesion por conexion
      const code = typeof msg.code === 'string' ? msg.code : '';

      send(ws, { type: 'status', status: 'queued' });
      slotAcquired = await acquireSlot();
      if (closed) return;

      send(ws, { type: 'status', status: 'compiling' });
      const prepared = await prepareProgram({ code, fileName: msg.fileName, forDebug: true });
      if (closed) {
        if (prepared.ok) await rm(prepared.dir, { recursive: true, force: true }).catch(() => {});
        return;
      }
      if (!prepared.ok) {
        send(ws, { type: 'compile-error', message: prepared.message, output: prepared.output });
        await cleanup();
        ws.close();
        return;
      }

      dir = prepared.dir;
      sourceName = path.basename(prepared.sourcePath);
      if (prepared.warnings) send(ws, { type: 'compile-warnings', output: prepared.warnings });

      // pty dedicada a la E/S del programa. El proceso "sleep" solo existe
      // para mantener la pty abierta; no lee ni escribe nada.
      inferiorTty = pty.spawn('sleep', [String(Math.ceil(HARD_TIMEOUT_MS / 1000))], {
        name: 'xterm-256color',
        cols: Number.isInteger(msg.cols) ? msg.cols : 80,
        rows: Number.isInteger(msg.rows) ? msg.rows : 24,
        cwd: dir,
        env: { PATH: process.env.PATH ?? '', HOME: dir, LANG: 'C.UTF-8' },
      });
      inferiorTty.onData((data) => {
        bumpIdle();
        send(ws, { type: 'data', data });
      });

      gdb = spawn('gdb', ['--interpreter=mi3', '--nx', prepared.binaryPath], {
        cwd: dir,
        env: { PATH: process.env.PATH ?? '', HOME: dir, LANG: 'C.UTF-8', TERM: 'dumb' },
      });
      gdb.stdout.on('data', onGdbOutput);
      gdb.on('error', () => {
        send(ws, { type: 'debug-error', message: 'No se pudo iniciar GDB en el servidor.' });
        cleanup().then(() => ws.close());
      });
      gdb.on('exit', () => {
        if (!closed) {
          send(ws, { type: 'exit', code: null, reason: 'debugger-terminado' });
          cleanup().then(() => ws.close());
        }
      });

      await mi(`-inferior-tty-set ${inferiorTty._pty}`);
      // Sin esto GDB corta los arrays/strings largos con "..."
      await mi('-gdb-set print elements 200');

      const lines = Array.isArray(msg.breakpoints) ? msg.breakpoints : [];
      for (const line of lines) {
        const n = toInt(line, 0);
        if (n > 0) {
          const res = await mi(`-break-insert ${sourceName}:${n}`);
          if (res.class === 'done' && res.data?.bkpt?.number) {
            breakpointIds.set(n, res.data.bkpt.number);
          }
        }
      }

      bumpIdle();
      hardTimer = setTimeout(() => {
        send(ws, { type: 'exit', code: null, reason: 'timeout' });
        cleanup().then(() => ws.close());
      }, HARD_TIMEOUT_MS);

      send(ws, { type: 'status', status: 'started', breakpoints: [...breakpointIds.keys()] });
      await mi('-exec-run');
      return;
    }

    if (!gdb) return;

    switch (msg.type) {
      case 'input':
        bumpIdle();
        inferiorTty?.write(msg.data ?? '');
        break;

      case 'continue':
        bumpIdle();
        mi('-exec-continue');
        break;

      case 'step': // entrar a la funcion
        bumpIdle();
        mi('-exec-step');
        break;

      case 'next': // saltear la funcion
        bumpIdle();
        mi('-exec-next');
        break;

      case 'finish': // salir de la funcion actual
        bumpIdle();
        mi('-exec-finish');
        break;

      case 'set-breakpoint': {
        const line = toInt(msg.line, 0);
        if (line <= 0 || breakpointIds.has(line)) break;
        const res = await mi(`-break-insert ${sourceName}:${line}`);
        if (res.class === 'done' && res.data?.bkpt?.number) {
          breakpointIds.set(line, res.data.bkpt.number);
          send(ws, { type: 'breakpoints', lines: [...breakpointIds.keys()] });
        }
        break;
      }

      case 'remove-breakpoint': {
        const line = toInt(msg.line, 0);
        const id = breakpointIds.get(line);
        if (!id) break;
        await mi(`-break-delete ${id}`);
        breakpointIds.delete(line);
        send(ws, { type: 'breakpoints', lines: [...breakpointIds.keys()] });
        break;
      }

      case 'evaluate': {
        const expr = typeof msg.expression === 'string' ? msg.expression.trim() : '';
        if (!expr) break;
        // Las comillas se escapan para que la expresion viaje entera como
        // un solo argumento MI.
        const res = await mi(`-data-evaluate-expression "${expr.replace(/(["\\])/g, '\\$1')}"`);
        send(ws, {
          type: 'evaluated',
          expression: expr,
          value: res.class === 'done' ? res.data?.value : null,
          error: res.class === 'done' ? null : res.data?.msg || 'no se pudo evaluar',
        });
        break;
      }

      case 'resize':
        if (inferiorTty && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
          try { inferiorTty.resize(msg.cols, msg.rows); } catch { /* ya termino */ }
        }
        break;

      case 'stop':
        send(ws, { type: 'exit', code: null, reason: 'detenido' });
        await cleanup();
        ws.close();
        break;
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
