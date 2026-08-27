import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_LANGUAGE, LANGUAGES, detectLanguage } from './languages.js';

const COMPILE_TIMEOUT_MS = 20_000;
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
 * Prepara un programa para ejecutarse: escribe el fuente en un directorio
 * temporal aislado y, si el lenguaje lo necesita, lo compila.
 *
 * Devuelve { ok: true, dir, argv: [cmd, args], warnings } listo para spawnear,
 * o { ok: false, message, output } si no compilo. El llamador es responsable
 * de borrar `dir` cuando termine.
 *
 * @param {object} opts
 * @param {string} opts.code       codigo fuente
 * @param {string} [opts.fileName] nombre del archivo (define el lenguaje por extension)
 * @param {boolean} [opts.forDebug] compilar con simbolos de debug (-g -O0)
 */
export async function prepareProgram({ code, fileName, forDebug = false }) {
  if (typeof code !== 'string' || code.length === 0) {
    return { ok: false, message: 'No hay codigo para ejecutar.' };
  }
  if (code.length > MAX_CODE_BYTES) {
    return { ok: false, message: 'El codigo es demasiado grande.' };
  }

  const lang = detectLanguage(fileName) ?? LANGUAGES[DEFAULT_LANGUAGE];
  if (forDebug && !lang.debuggable) {
    return { ok: false, message: `El debugger todavia no soporta ${lang.name}.` };
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'run-'));
  // Respetamos el nombre real del archivo cuando es valido (Java exige que
  // coincida con el nombre de la clase publica); si no, usamos el default
  // del lenguaje.
  const base = path.basename(String(fileName || ''));
  const safeName = /^[A-Za-z0-9._-]+$/.test(base) && base !== '.' && base !== '..' ? base : lang.sourceName;
  const sourcePath = path.join(dir, safeName);
  const binaryPath = path.join(dir, 'prog');
  await writeFile(sourcePath, code, 'utf8');

  const cleanPaths = (text) => text.split(sourcePath).join(safeName).split(dir + path.sep).join('');

  let warnings = '';
  const compileStep = forDebug && lang.debugCompile ? lang.debugCompile : lang.compile;
  if (compileStep) {
    const [cmd, args] = compileStep(sourcePath, binaryPath, dir);
    const compile = await execFileAsync(cmd, args, {
      cwd: dir,
      timeout: COMPILE_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    if (compile.error) {
      const timedOut = Boolean(compile.error.killed || compile.error.signal);
      const raw = compile.stderr || compile.stdout || compile.error.message;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return {
        ok: false,
        message: timedOut ? 'La compilacion tardo demasiado.' : 'Error de compilacion.',
        output: cleanPaths(raw),
      };
    }
    warnings = cleanPaths(compile.stderr || '');
  }

  const [runCmd, runArgs] = lang.run(sourcePath, binaryPath, dir);
  return {
    ok: true,
    dir,
    sourcePath,
    binaryPath,
    language: lang.id,
    argv: [runCmd, runArgs],
    warnings,
  };
}
