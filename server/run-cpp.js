import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const COMPILE_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 200_000;
const MAX_CODE_BYTES = 200_000;

function execFileAsync(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

/**
 * Compila un programa C++ en un directorio temporal aislado y devuelve
 * la ruta al binario. Nunca usa un shell (execFile con arrays de
 * argumentos), asi que el codigo del usuario jamas se interpreta como
 * comando. El llamador es responsable de borrar `dir` cuando termine.
 */
export async function compileToBinary(code) {
  if (typeof code !== 'string' || code.length === 0) {
    return { ok: false, message: 'No hay codigo para compilar.' };
  }
  if (code.length > MAX_CODE_BYTES) {
    return { ok: false, message: 'El codigo es demasiado grande.' };
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'cpp-run-'));
  const sourcePath = path.join(dir, 'main.cpp');
  const binaryPath = path.join(dir, 'prog');
  await writeFile(sourcePath, code, 'utf8');

  const compile = await execFileAsync(
    'g++',
    ['-O2', '-std=c++20', '-Wall', sourcePath, '-o', binaryPath],
    { timeout: COMPILE_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }
  );

  if (compile.error) {
    const timedOut = Boolean(compile.error.killed || compile.error.signal);
    const rawOutput = compile.stderr || compile.error.message;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      message: timedOut ? 'La compilacion tardo demasiado.' : 'Error de compilacion.',
      output: rawOutput.split(sourcePath).join('main.cpp'),
    };
  }

  return {
    ok: true,
    dir,
    binaryPath,
    warnings: (compile.stderr || '').split(sourcePath).join('main.cpp'),
  };
}
