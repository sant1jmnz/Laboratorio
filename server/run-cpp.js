import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const COMPILE_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 6_000;
const MAX_OUTPUT_BYTES = 200_000;
const MAX_CODE_BYTES = 200_000;
const MAX_CONCURRENT = 3;

let running = 0;
const queue = [];

function acquireSlot() {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot() {
  running--;
  const next = queue.shift();
  if (next) {
    running++;
    next();
  }
}

function execFileAsync(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function runProgram(binaryPath, stdin) {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, [], {
      timeout: RUN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    const kill = () => {
      truncated = true;
      child.kill('SIGKILL');
    };

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
      else kill();
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
      else kill();
    });

    child.on('error', (err) => {
      resolve({ stdout, stderr: stderr + '\n' + err.message, code: null, truncated, timedOut });
    });

    child.on('close', (code, signal) => {
      timedOut = signal !== null && !truncated;
      resolve({ stdout, stderr, code, truncated, timedOut });
    });

    child.stdin.write(stdin ?? '');
    child.stdin.end();
  });
}

/**
 * Compila y corre un programa C++ en un directorio temporal aislado.
 * Nunca usa un shell (execFile/spawn con arrays de argumentos), asi que
 * el codigo fuente del usuario jamas se interpreta como comando.
 */
export async function compileAndRun(code, stdin) {
  if (typeof code !== 'string' || code.length === 0) {
    return { stage: 'validate', ok: false, message: 'No hay codigo para compilar.' };
  }
  if (code.length > MAX_CODE_BYTES) {
    return { stage: 'validate', ok: false, message: 'El codigo es demasiado grande.' };
  }

  await acquireSlot();
  let dir;
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cpp-run-'));
    const sourcePath = path.join(dir, 'main.cpp');
    const binaryPath = path.join(dir, 'prog');
    await writeFile(sourcePath, code, 'utf8');

    const compile = await execFileAsync(
      'g++',
      ['-O2', '-std=c++20', '-Wall', sourcePath, '-o', binaryPath],
      { timeout: COMPILE_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }
    );

    if (compile.error) {
      const timedOut = compile.error.killed || compile.error.signal;
      const rawOutput = compile.stderr || compile.error.message;
      return {
        stage: 'compile',
        ok: false,
        message: timedOut ? 'La compilacion tardo demasiado.' : 'Error de compilacion.',
        output: rawOutput.split(sourcePath).join('main.cpp'),
      };
    }

    const run = await runProgram(binaryPath, stdin ?? '');
    return {
      stage: 'run',
      ok: run.code === 0,
      exitCode: run.code,
      timedOut: run.timedOut,
      truncated: run.truncated,
      stdout: run.stdout,
      stderr: run.stderr,
      compileWarnings: (compile.stderr || '').split(sourcePath).join('main.cpp'),
    };
  } finally {
    releaseSlot();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
