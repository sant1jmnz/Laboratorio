import { execFile } from 'node:child_process';
import { LANGUAGES, detectLanguage } from './languages.js';

const FORMAT_TIMEOUT_MS = 10_000;
const MAX_CODE_BYTES = 200_000;

/**
 * Formateadores por lenguaje.
 *
 * clang-format cubre C, C++, Java y JavaScript; Python va con black. Los dos
 * leen de stdin y escriben a stdout, asi que nunca tocamos el disco: le
 * pasamos --assume-filename para que clang-format sepa que gramatica usar.
 *
 * IndentWidth 4 coincide con la indentacion que usa el editor (indentUnit).
 */
const CLANG_STYLE = '{BasedOnStyle: LLVM, IndentWidth: 4, ColumnLimit: 100}';
const CLANG_STYLE_JAVA = '{BasedOnStyle: Google, IndentWidth: 4, ColumnLimit: 100}';

const FORMATTERS = {
  cpp: () => ['clang-format', ['--assume-filename=main.cpp', `--style=${CLANG_STYLE}`]],
  c: () => ['clang-format', ['--assume-filename=main.c', `--style=${CLANG_STYLE}`]],
  javascript: () => ['clang-format', ['--assume-filename=main.js', `--style=${CLANG_STYLE}`]],
  java: () => ['clang-format', ['--assume-filename=Main.java', `--style=${CLANG_STYLE_JAVA}`]],
  python: () => ['black', ['-q', '--stdin-filename', 'main.py', '-']],
};

/** Extensiones que no se ejecutan solas pero sí se pueden formatear. */
const EXTRA_EXTENSIONS = {
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.mjs': 'javascript',
};

function languageIdFor(fileName) {
  const detected = detectLanguage(fileName);
  if (detected && FORMATTERS[detected.id]) return detected.id;
  const dot = String(fileName ?? '').lastIndexOf('.');
  const ext = dot === -1 ? '' : String(fileName).slice(dot).toLowerCase();
  return EXTRA_EXTENSIONS[ext] ?? null;
}

export function canFormat(fileName) {
  return languageIdFor(fileName) !== null;
}

/** Extensiones formateables, para que el cliente no duplique esta lista. */
export function formatExtensions() {
  const fromLanguages = Object.keys(FORMATTERS).flatMap((id) => LANGUAGES[id]?.extensions ?? []);
  return [...new Set([...fromLanguages, ...Object.keys(EXTRA_EXTENSIONS)])];
}

/**
 * Devuelve el codigo formateado, o un error explicando por que no se pudo.
 * Si el codigo no compila, los formateadores suelen fallar: en ese caso
 * avisamos en vez de devolver algo a medias.
 */
export function formatCode(code, fileName) {
  if (typeof code !== 'string' || code.length === 0) {
    return Promise.resolve({ ok: false, message: 'No hay codigo para formatear.' });
  }
  if (code.length > MAX_CODE_BYTES) {
    return Promise.resolve({ ok: false, message: 'El archivo es demasiado grande para formatear.' });
  }

  const langId = languageIdFor(fileName);
  if (!langId) {
    return Promise.resolve({ ok: false, message: 'No hay formateador para este tipo de archivo.' });
  }

  const [cmd, args] = FORMATTERS[langId]();
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { timeout: FORMAT_TIMEOUT_MS, maxBuffer: MAX_CODE_BYTES * 2 },
      (error, stdout, stderr) => {
        if (error) {
          // ENOENT = el formateador no esta instalado en el servidor; es un
          // problema de configuracion, no del codigo del usuario.
          const missing = error.code === 'ENOENT';
          const timedOut = Boolean(error.killed || error.signal);
          resolve({
            ok: false,
            message: missing
              ? `El servidor no tiene instalado "${cmd}", asi que no puede formatear este lenguaje.`
              : timedOut
                ? 'El formateo tardo demasiado.'
                : 'No se pudo formatear: revisá que el código no tenga errores de sintaxis.',
            output: missing ? '' : (stderr || '').slice(0, 2000),
          });
          return;
        }
        resolve({ ok: true, code: stdout });
      }
    );
    child.stdin.on('error', () => {}); // el proceso puede cerrar stdin antes de tiempo
    child.stdin.end(code);
  });
}
