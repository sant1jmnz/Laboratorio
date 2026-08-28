/**
 * Parser del formato de salida "MI" (Machine Interface) de GDB.
 *
 * Gramatica que nos interesa:
 *   record   := [token] ('^'|'*'|'='|'+') clase (',' result)*
 *   result   := variable '=' value
 *   value    := const | tuple | list
 *   const    := '"' c-string '"'
 *   tuple    := '{}' | '{' result (',' result)* '}'
 *   list     := '[]' | '[' (value|result) (',' (value|result))* ']'
 */

function unescapeC(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') {
      out += s[i];
      continue;
    }
    const next = s[++i];
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'r') out += '\r';
    else if (next === '\\') out += '\\';
    else if (next === '"') out += '"';
    else if (next === '0') out += '\0';
    else out += next;
  }
  return out;
}

class Cursor {
  constructor(text) {
    this.text = text;
    this.i = 0;
  }
  peek() {
    return this.text[this.i];
  }
  eat(ch) {
    if (this.text[this.i] === ch) {
      this.i++;
      return true;
    }
    return false;
  }
}

function parseString(cur) {
  // Asume que cur.peek() === '"'
  cur.i++;
  let raw = '';
  while (cur.i < cur.text.length) {
    const ch = cur.text[cur.i];
    if (ch === '\\') {
      raw += ch + (cur.text[cur.i + 1] ?? '');
      cur.i += 2;
      continue;
    }
    if (ch === '"') {
      cur.i++;
      return unescapeC(raw);
    }
    raw += ch;
    cur.i++;
  }
  return unescapeC(raw);
}

function parseVariableName(cur) {
  let name = '';
  while (cur.i < cur.text.length && /[A-Za-z0-9_-]/.test(cur.text[cur.i])) {
    name += cur.text[cur.i];
    cur.i++;
  }
  return name;
}

function parseValue(cur) {
  const ch = cur.peek();
  if (ch === '"') return parseString(cur);
  if (ch === '{') return parseTuple(cur);
  if (ch === '[') return parseList(cur);
  // Valor suelto sin comillas (poco comun, pero GDB lo emite en algunos casos)
  let raw = '';
  while (cur.i < cur.text.length && !',}]'.includes(cur.text[cur.i])) {
    raw += cur.text[cur.i];
    cur.i++;
  }
  return raw;
}

function parseTuple(cur) {
  cur.i++; // '{'
  const obj = {};
  if (cur.eat('}')) return obj;
  for (;;) {
    const name = parseVariableName(cur);
    cur.eat('=');
    obj[name] = parseValue(cur);
    if (cur.eat(',')) continue;
    cur.eat('}');
    return obj;
  }
}

function parseList(cur) {
  cur.i++; // '['
  const arr = [];
  if (cur.eat(']')) return arr;
  for (;;) {
    // Una lista puede tener valores sueltos o pares nombre=valor
    // (ej. stack=[frame={...},frame={...}]); en ambos casos nos quedamos
    // con el valor, que es lo unico que usamos.
    const save = cur.i;
    const name = parseVariableName(cur);
    if (name && cur.peek() === '=') {
      cur.i++;
      arr.push(parseValue(cur));
    } else {
      cur.i = save;
      arr.push(parseValue(cur));
    }
    if (cur.eat(',')) continue;
    cur.eat(']');
    return arr;
  }
}

/**
 * Parsea una linea de salida MI.
 * Devuelve null para lineas que no son records (ej. el prompt "(gdb)").
 *
 * - `kind`: 'result' (^), 'exec' (*), 'notify' (=), 'status' (+),
 *           'console' (~), 'target' (@), 'log' (&)
 * - `token`: numero de correlacion que le pusimos al comando, si habia
 * - `class`: 'done' | 'running' | 'stopped' | 'error' | ...
 * - `data`: el resto del record ya parseado
 */
export function parseMiLine(line) {
  const text = line.trimEnd();
  if (!text || text === '(gdb)' || text === '(gdb) ') return null;

  // Los streams (~ @ &) son texto plano, no records estructurados
  const streamKinds = { '~': 'console', '@': 'target', '&': 'log' };
  if (streamKinds[text[0]]) {
    const cur = new Cursor(text.slice(1));
    return { kind: streamKinds[text[0]], text: cur.peek() === '"' ? parseString(cur) : text.slice(1) };
  }

  let i = 0;
  let token = '';
  while (i < text.length && /[0-9]/.test(text[i])) token += text[i++];

  const kinds = { '^': 'result', '*': 'exec', '=': 'notify', '+': 'status' };
  const kind = kinds[text[i]];
  if (!kind) return null;
  i++;

  const cur = new Cursor(text.slice(i));
  const klass = parseVariableName(cur);
  const data = {};
  while (cur.eat(',')) {
    const name = parseVariableName(cur);
    cur.eat('=');
    data[name] = parseValue(cur);
  }

  return { kind, token: token || null, class: klass, data };
}
