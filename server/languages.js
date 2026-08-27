import path from 'node:path';

/**
 * Registro de lenguajes soportados.
 *
 * Cada lenguaje define como llevar un archivo fuente a un proceso corriendo:
 *  - `compile(srcPath, outPath, dir)` -> [comando, args] o null si es interpretado.
 *  - `run(srcPath, outPath, dir)`     -> [comando, args] del proceso final.
 *
 * Todo se ejecuta con execFile/spawn pasando arrays de argumentos (nunca un
 * shell), asi que el codigo del usuario jamas se interpreta como comando.
 */
export const LANGUAGES = {
  cpp: {
    id: 'cpp',
    name: 'C++',
    label: 'C++20',
    extensions: ['.cpp', '.cc', '.cxx', '.c++'],
    sourceName: 'main.cpp',
    debuggable: true,
    compile: (src, out) => ['g++', ['-O2', '-std=c++20', '-Wall', src, '-o', out]],
    debugCompile: (src, out) => ['g++', ['-g', '-O0', '-std=c++20', src, '-o', out]],
    run: (_src, out) => [out, []],
  },
  c: {
    id: 'c',
    name: 'C',
    label: 'C17',
    extensions: ['.c'],
    sourceName: 'main.c',
    debuggable: true,
    compile: (src, out) => ['gcc', ['-O2', '-std=c17', '-Wall', src, '-o', out]],
    debugCompile: (src, out) => ['gcc', ['-g', '-O0', '-std=c17', src, '-o', out]],
    run: (_src, out) => [out, []],
  },
  python: {
    id: 'python',
    name: 'Python',
    label: 'Python 3',
    extensions: ['.py'],
    sourceName: 'main.py',
    debuggable: false,
    compile: null,
    // -u = sin buffering, para que los prints salgan al instante en la terminal
    run: (src) => ['python3', ['-u', src]],
  },
  javascript: {
    id: 'javascript',
    name: 'JavaScript',
    label: 'Node.js',
    extensions: ['.js', '.mjs'],
    sourceName: 'main.js',
    debuggable: false,
    compile: null,
    run: (src) => ['node', [src]],
  },
  java: {
    id: 'java',
    name: 'Java',
    label: 'Java',
    extensions: ['.java'],
    sourceName: 'Main.java',
    debuggable: false,
    compile: (src) => ['javac', [src]],
    // La clase a ejecutar es el nombre del archivo sin extension, que es lo
    // que javac produce como <Clase>.class dentro del mismo directorio.
    run: (src, _out, dir) => ['java', ['-cp', dir, path.basename(src, '.java')]],
  },
};

export const DEFAULT_LANGUAGE = 'cpp';

/** Devuelve el lenguaje segun la extension del archivo, o null si no se reconoce. */
export function detectLanguage(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!ext) return null;
  for (const lang of Object.values(LANGUAGES)) {
    if (lang.extensions.includes(ext)) return lang;
  }
  return null;
}

/** Lista liviana para el cliente (sin las funciones de compile/run). */
export function languageSummaries() {
  return Object.values(LANGUAGES).map(({ id, name, label, extensions, sourceName, debuggable }) => ({
    id,
    name,
    label,
    extensions,
    sourceName,
    debuggable,
  }));
}
