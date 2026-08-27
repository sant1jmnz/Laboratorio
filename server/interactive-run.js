import { rm } from 'node:fs/promises';
import * as pty from 'node-pty';
import { compileToBinary } from './run-cpp.js';

const MAX_CONCURRENT = 6;
const IDLE_TIMEOUT_MS = 3 * 60_000; // sin entrada/salida por 3 min -> se corta
const HARD_TIMEOUT_MS = 10 * 60_000; // tope absoluto por sesion

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

/**
 * Maneja una conexion WebSocket dedicada a una unica ejecucion interactiva:
 * el cliente manda el codigo, el servidor compila y corre el binario en
 * una pty real (misma idea que un IDE online: eco de terminal, cin
 * bloqueante linea a linea, Ctrl+C, etc), y reenvia stdin/stdout en vivo.
 */
export function handleInteractiveConnection(ws) {
  let slotAcquired = false;
  let ptyProcess = null;
  let dir = null;
  let idleTimer = null;
  let hardTimer = null;
  let closed = false;

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
    if (ptyProcess) {
      try { ptyProcess.kill(); } catch { /* ya murio */ }
    }
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    if (slotAcquired) releaseSlot();
  };

  const bumpIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send(ws, { type: 'exit', code: null, reason: 'idle' });
      cleanup();
      ws.close();
    }, IDLE_TIMEOUT_MS);
  };

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'run') {
      if (ptyProcess) return; // ya hay una ejecucion en esta conexion
      const code = typeof msg.code === 'string' ? msg.code : '';

      send(ws, { type: 'status', status: 'queued' });
      slotAcquired = await acquireSlot();
      if (closed) return;

      send(ws, { type: 'status', status: 'compiling' });
      const compiled = await compileToBinary(code);
      if (closed) return;

      if (!compiled.ok) {
        send(ws, { type: 'compile-error', message: compiled.message, output: compiled.output });
        await cleanup();
        ws.close();
        return;
      }

      dir = compiled.dir;
      if (compiled.warnings) send(ws, { type: 'compile-warnings', output: compiled.warnings });

      const cols = Number.isInteger(msg.cols) ? msg.cols : 80;
      const rows = Number.isInteger(msg.rows) ? msg.rows : 24;

      ptyProcess = pty.spawn(compiled.binaryPath, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: dir,
        env: { PATH: process.env.PATH ?? '' },
      });

      send(ws, { type: 'status', status: 'running' });
      bumpIdleTimer();
      hardTimer = setTimeout(() => {
        send(ws, { type: 'exit', code: null, reason: 'timeout' });
        cleanup();
        ws.close();
      }, HARD_TIMEOUT_MS);

      ptyProcess.onData((data) => {
        bumpIdleTimer();
        send(ws, { type: 'data', data });
      });

      ptyProcess.onExit(({ exitCode }) => {
        send(ws, { type: 'exit', code: exitCode });
        cleanup();
      });
      return;
    }

    if (msg.type === 'input' && ptyProcess) {
      bumpIdleTimer();
      ptyProcess.write(msg.data ?? '');
      return;
    }

    if (msg.type === 'resize' && ptyProcess) {
      const cols = Number.isInteger(msg.cols) ? msg.cols : 80;
      const rows = Number.isInteger(msg.rows) ? msg.rows : 24;
      try { ptyProcess.resize(cols, rows); } catch { /* proceso ya termino */ }
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
