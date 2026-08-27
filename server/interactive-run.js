import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import * as pty from 'node-pty';
import { compileToBinary } from './run-cpp.js';

const MAX_CONCURRENT = 6;
const IDLE_TIMEOUT_MS = 3 * 60_000; // sin entrada/salida por 3 min -> se corta
const HARD_TIMEOUT_MS = 10 * 60_000; // tope absoluto por sesion
const FILES_GRACE_MS = 5 * 60_000; // cuanto quedan disponibles los archivos generados despues de terminar
const MAX_FILE_READ_BYTES = 5 * 1024 * 1024;

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

async function listGeneratedFiles(dir, binaryPath) {
  const skip = new Set(['main.cpp', path.basename(binaryPath)]);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || skip.has(entry.name)) continue;
    try {
      const info = await stat(path.join(dir, entry.name));
      files.push({ name: entry.name, size: info.size });
    } catch {
      // el archivo pudo haber sido borrado por el propio programa entre el readdir y el stat
    }
  }
  return files;
}

/**
 * Maneja una conexion WebSocket dedicada a una unica ejecucion interactiva:
 * el cliente manda el codigo, el servidor compila y corre el binario en
 * una pty real (misma idea que un IDE online: eco de terminal, cin
 * bloqueante linea a linea, Ctrl+C, etc), reenvia stdin/stdout en vivo, y
 * despues de terminar deja ver/descargar los archivos que el programa
 * haya creado (ej. los .dat de fstream) durante unos minutos.
 */
export function handleInteractiveConnection(ws) {
  let slotAcquired = false;
  let ptyProcess = null;
  let dir = null;
  let binaryPath = null;
  let idleTimer = null;
  let hardTimer = null;
  let filesGraceTimer = null;
  let dirRemoved = false;
  let socketClosed = false;

  const removeDir = async () => {
    if (dirRemoved) return;
    dirRemoved = true;
    clearTimeout(filesGraceTimer);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  const releaseProcess = () => {
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
    if (ptyProcess) {
      try { ptyProcess.kill(); } catch { /* ya murio */ }
      ptyProcess = null;
    }
    if (slotAcquired) {
      slotAcquired = false;
      releaseSlot();
    }
  };

  const onProcessExit = async (exitCode) => {
    releaseProcess();
    const files = await listGeneratedFiles(dir, binaryPath);
    send(ws, { type: 'exit', code: exitCode, files });
    filesGraceTimer = setTimeout(async () => {
      await removeDir();
      ws.close();
    }, FILES_GRACE_MS);
  };

  const bumpIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send(ws, { type: 'exit', code: null, reason: 'idle', files: [] });
      releaseProcess();
      removeDir();
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
      if (ptyProcess || dir) return; // ya se uso esta conexion para una ejecucion
      const code = typeof msg.code === 'string' ? msg.code : '';

      send(ws, { type: 'status', status: 'queued' });
      slotAcquired = await acquireSlot();
      if (socketClosed) return;

      send(ws, { type: 'status', status: 'compiling' });
      const compiled = await compileToBinary(code);
      if (socketClosed) {
        if (compiled.ok) await rm(compiled.dir, { recursive: true, force: true }).catch(() => {});
        return;
      }

      if (!compiled.ok) {
        send(ws, { type: 'compile-error', message: compiled.message, output: compiled.output });
        releaseProcess();
        ws.close();
        return;
      }

      dir = compiled.dir;
      binaryPath = compiled.binaryPath;
      if (compiled.warnings) send(ws, { type: 'compile-warnings', output: compiled.warnings });

      const cols = Number.isInteger(msg.cols) ? msg.cols : 80;
      const rows = Number.isInteger(msg.rows) ? msg.rows : 24;

      ptyProcess = pty.spawn(binaryPath, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: dir,
        env: { PATH: process.env.PATH ?? '' },
      });

      send(ws, { type: 'status', status: 'running' });
      bumpIdleTimer();
      hardTimer = setTimeout(() => {
        send(ws, { type: 'exit', code: null, reason: 'timeout', files: [] });
        releaseProcess();
        removeDir();
        ws.close();
      }, HARD_TIMEOUT_MS);

      ptyProcess.onData((data) => {
        bumpIdleTimer();
        send(ws, { type: 'data', data });
      });

      ptyProcess.onExit(({ exitCode }) => onProcessExit(exitCode));
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

    if (msg.type === 'get-file' && dir && !dirRemoved) {
      const name = typeof msg.name === 'string' ? path.basename(msg.name) : '';
      const filePath = path.join(dir, name);
      if (!name || path.dirname(filePath) !== dir) {
        send(ws, { type: 'file-content', name, error: 'nombre invalido' });
        return;
      }
      try {
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error('no es un archivo');
        const truncated = info.size > MAX_FILE_READ_BYTES;
        const buf = await readFile(filePath);
        const data = truncated ? buf.subarray(0, MAX_FILE_READ_BYTES) : buf;
        send(ws, {
          type: 'file-content',
          name,
          size: info.size,
          truncated,
          base64: data.toString('base64'),
        });
      } catch {
        send(ws, { type: 'file-content', name, error: 'no se pudo leer el archivo' });
      }
    }
  });

  ws.on('close', () => {
    socketClosed = true;
    releaseProcess();
    removeDir();
  });
  ws.on('error', () => {
    socketClosed = true;
    releaseProcess();
    removeDir();
  });
}
