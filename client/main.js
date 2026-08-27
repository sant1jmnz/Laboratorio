import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history as cmHistory, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { cpp } from '@codemirror/lang-cpp';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const loginOverlay = document.getElementById('login-overlay');
const loginCard = document.getElementById('login-card');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');

const roomInput = document.getElementById('room');
const joinBtn = document.getElementById('join');
const shareBtn = document.getElementById('share');
const saveBtn = document.getElementById('save');
const runBtn = document.getElementById('run');
const peersEl = document.getElementById('peers');
const editorEl = document.getElementById('editor');
const bootHintEl = document.getElementById('boot-hint');
const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('status-text');
const outputPanel = document.getElementById('output-panel');
const panelToggle = document.getElementById('panel-toggle');
const outputStatus = document.getElementById('output-status');
const terminalEl = document.getElementById('terminal');
const fileTabsEl = document.getElementById('file-tabs');
const fileViewerEl = document.getElementById('file-viewer');
const fileViewerNameEl = document.getElementById('file-viewer-name');
const fileViewerMetaEl = document.getElementById('file-viewer-meta');
const fileViewerBodyEl = document.getElementById('file-viewer-body');
const fileViewerDownloadBtn = document.getElementById('file-viewer-download');
const sidebarFileListEl = document.getElementById('file-list');
const newFileBtn = document.getElementById('new-file-btn');
const newFileRow = document.getElementById('new-file-row');
const newFileInput = document.getElementById('new-file-input');

const USER_COLORS = ['#4fa6ff', '#7ee787', '#ffbc42', '#f2cc60', '#ff7b72', '#9ac2c9', '#d2a8ff', '#39c5cf'];
const userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
const userName = 'Usuario-' + Math.floor(Math.random() * 1000);

const DEFAULT_CODE = '#include <iostream>\n\nint main() {\n    std::cout << "Hola mundo" << std::endl;\n    return 0;\n}\n';

// ---------------------------------------------------------------------
// Autenticacion: clave compartida opcional (APP_PASSWORD en el server).
// ---------------------------------------------------------------------
const AUTH_TOKEN_KEY = 'editorAuthToken';

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}
function setToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}
function clearToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function wsAuthParams() {
  const token = getToken();
  return token ? { token } : {};
}

async function authFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...authHeaders() },
  });
  if (res.status === 401) {
    clearToken();
    showLogin('Tu sesion expiro. Ingresá la clave de nuevo.');
  }
  return res;
}

function showLogin(message) {
  loginOverlay.classList.add('visible');
  loginError.textContent = message || '';
  loginPassword.value = '';
  loginPassword.focus();
}
function hideLogin() {
  loginOverlay.classList.remove('visible');
}

loginCard.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: loginPassword.value }),
    });
    const data = await res.json();
    if (data.ok) {
      setToken(data.token);
      hideLogin();
      startApp();
    } else {
      loginError.textContent = data.message || 'Clave incorrecta.';
    }
  } catch {
    loginError.textContent = 'Error de red.';
  }
});

// Colores del tema "Dark+" de VS Code
const darkPlusTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#1e1e1e', color: '#d4d4d4', height: '100%' },
    '.cm-content': { caretColor: '#aeafad', padding: '14px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#aeafad' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#264f78',
    },
    '.cm-gutters': {
      backgroundColor: '#1e1e1e',
      color: '#858585',
      border: 'none',
      borderRight: '1px solid #2b2b2b',
    },
    '.cm-activeLine': { backgroundColor: '#2a2d2e' },
    '.cm-activeLineGutter': { backgroundColor: '#2a2d2e', color: '#c6c6c6' },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: '#3a3d41',
      outline: '1px solid #5a5d63',
    },
    '.cm-scroller': { overflow: 'auto' },
  },
  { dark: true }
);

const darkPlusHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword], color: '#569cd6' },
  { tag: [t.moduleKeyword, t.processingInstruction], color: '#c586c0' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#9cdcfe' },
  { tag: t.variableName, color: '#9cdcfe' },
  { tag: t.propertyName, color: '#9cdcfe' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#dcdcaa' },
  { tag: [t.typeName, t.className, t.namespace], color: '#4ec9b0' },
  { tag: t.number, color: '#b5cea8' },
  { tag: [t.string, t.special(t.string)], color: '#ce9178' },
  { tag: t.regexp, color: '#d16969' },
  { tag: t.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: t.meta, color: '#c586c0' },
  { tag: t.definitionOperator, color: '#d4d4d4' },
  { tag: t.operator, color: '#d4d4d4' },
  { tag: t.punctuation, color: '#d4d4d4' },
  { tag: t.bracket, color: '#ffd700' },
  { tag: t.bool, color: '#569cd6' },
  { tag: t.self, color: '#569cd6' },
  { tag: t.invalid, color: '#f14c4c' },
]);

const term = new Terminal({
  convertEol: true,
  fontFamily: "'Cascadia Mono', ui-monospace, Consolas, Menlo, monospace",
  fontSize: 13,
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#aeafad',
    selectionBackground: '#264f78',
  },
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(terminalEl);
fitAddon.fit();
term.writeln('Presioná "▶ Ejecutar" (o Ctrl+Enter) para compilar y correr el archivo activo.');
new ResizeObserver(() => fitAddon.fit()).observe(terminalEl);

let currentView = null;
let currentProvider = null;
let currentDoc = null;
let currentRoom = null;
let filesArray = null;
let activeFile = null;
let runSocket = null;

function getRoomFromUrl() {
  const params = new URLSearchParams(location.search);
  return params.get('room') || 'general';
}

function setRoomInUrl(room) {
  const url = new URL(location.href);
  url.searchParams.set('room', room);
  window.history.pushState({}, '', url);
}

function setStatus(state, text) {
  statusEl.className = state;
  statusTextEl.textContent = text;
}

function initials(name) {
  return name.replace('Usuario-', '#').slice(0, 3).toUpperCase();
}

function renderPeers(awareness) {
  const states = Array.from(awareness.getStates().entries());
  peersEl.innerHTML = '';
  for (const [, state] of states) {
    if (!state.user) continue;
    const el = document.createElement('div');
    el.className = 'peer-avatar';
    el.style.background = state.user.color;
    el.title = state.user.name;
    el.textContent = initials(state.user.name);
    peersEl.appendChild(el);
  }
}

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(location.href);
  } catch {
    // Sin acceso al portapapeles: no hay respaldo funcional, el usuario
    // puede copiar la URL de la barra de direcciones manualmente.
  }
  shareBtn.textContent = '¡Copiado!';
  shareBtn.classList.add('copied');
  setTimeout(() => {
    shareBtn.textContent = 'Compartir';
    shareBtn.classList.remove('copied');
  }, 1500);
}

function setPanelCollapsed(collapsed) {
  outputPanel.classList.toggle('collapsed', collapsed);
  panelToggle.textContent = collapsed ? '▸' : '▾';
}

function setOutputStatus(text, className) {
  outputStatus.textContent = text;
  outputStatus.className = className;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function downloadBytes(name, bytes) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function decodeAsText(bytes) {
  if (bytes.includes(0)) return null; // bytes nulos -> casi seguro binario
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// El contenido (nombres de archivo y bytes) lo produce el programa que
// corrio el usuario, asi que nunca se inserta como HTML sin escapar.
function hexDump(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, offset + 16);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(47, ' ');
    const ascii = escapeHtml(
      Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
    );
    lines.push(
      `<span class="hex-offset">${offset.toString(16).padStart(8, '0')}</span>  ` +
        `<span class="hex-bytes">${hex}</span>  <span class="hex-ascii">${ascii}</span>`
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// Pestañas de salida: archivos que el programa crea al correr (solo
// lectura, texto o hex dump). Distinto del explorador de la izquierda,
// que son los archivos fuente editables del workspace.
// ---------------------------------------------------------------------
const outputFileCache = new Map();
let activeOutputTab = null;

function showOutputTab(name) {
  activeOutputTab = name;
  fileViewerEl.classList.toggle('visible', name !== null);
  for (const btn of fileTabsEl.querySelectorAll('.file-tab')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  if (name === null) return;

  const cached = outputFileCache.get(name);
  fileViewerNameEl.textContent = name;
  if (!cached) {
    fileViewerMetaEl.textContent = 'cargando…';
    fileViewerBodyEl.textContent = '';
    return;
  }
  fileViewerMetaEl.textContent = `${formatBytes(cached.size)}${cached.truncated ? ' (recortado)' : ''}${cached.isText ? '' : ' · binario'}`;
  if (cached.isText) {
    fileViewerBodyEl.textContent = cached.text;
  } else {
    fileViewerBodyEl.innerHTML = hexDump(cached.bytes) || '(archivo vacio)';
  }
}

function closeOutputTab(name, btn) {
  btn.remove();
  outputFileCache.delete(name);
  fileTabsEl.classList.toggle('visible', fileTabsEl.children.length > 0);
  if (activeOutputTab === name) showOutputTab(null);
}

function fetchOutputFileContent(socket, name) {
  if (outputFileCache.has(name) || !socket || socket.readyState !== WebSocket.OPEN) return;

  const onMessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type !== 'file-content' || msg.name !== name) return;
    socket.removeEventListener('message', onMessage);
    if (msg.error) {
      outputFileCache.set(name, { size: 0, bytes: new Uint8Array(), isText: true, text: `(${msg.error})` });
    } else {
      const bytes = base64ToBytes(msg.base64);
      const text = decodeAsText(bytes);
      outputFileCache.set(name, { size: msg.size, truncated: msg.truncated, bytes, isText: text !== null, text });
    }
    if (activeOutputTab === name) showOutputTab(name);
  };
  socket.addEventListener('message', onMessage);
  socket.send(JSON.stringify({ type: 'get-file', name }));
}

function addOutputTab(socket, name) {
  if (fileTabsEl.querySelector(`.file-tab[data-tab="${CSS.escape(name)}"]`)) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'file-tab';
  btn.dataset.tab = name;
  const nameSpan = document.createElement('span');
  nameSpan.textContent = name;
  const closeSpan = document.createElement('span');
  closeSpan.className = 'tab-close';
  closeSpan.title = 'Cerrar';
  closeSpan.textContent = '✕';
  btn.append(nameSpan, closeSpan);
  btn.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) {
      closeOutputTab(name, btn);
      return;
    }
    showOutputTab(name);
    fetchOutputFileContent(socket, name);
  });
  fileTabsEl.appendChild(btn);
  fileTabsEl.classList.add('visible');
}

function resetOutputTabs() {
  outputFileCache.clear();
  fileTabsEl.innerHTML = '';
  fileTabsEl.classList.remove('visible');
  showOutputTab(null);
}

function renderGeneratedFiles(files, socket) {
  for (const file of files) addOutputTab(socket, file.name);
  if (files.length > 0 && activeOutputTab === null) {
    showOutputTab(files[0].name);
    fetchOutputFileContent(socket, files[0].name);
  }
}

fileViewerDownloadBtn.addEventListener('click', () => {
  const cached = outputFileCache.get(activeOutputTab);
  if (cached) downloadBytes(activeOutputTab, cached.bytes);
});

// ---------------------------------------------------------------------
// Compilar / ejecutar (compila el archivo activo en el editor)
// ---------------------------------------------------------------------
function runCode() {
  if (!currentDoc || !activeFile) return;
  const code = fileYText(activeFile).toString();

  runSocket?.close();
  term.reset();
  setPanelCollapsed(false);
  setOutputStatus('conectando…', 'busy');
  resetOutputTabs();
  runBtn.disabled = true;

  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const qs = new URLSearchParams(wsAuthParams()).toString();
  const socket = new WebSocket(`${wsProtocol}://${location.host}/run-ws${qs ? '?' + qs : ''}`);
  runSocket = socket;

  const inputDisposable = term.onData((data) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input', data }));
    }
  });

  socket.addEventListener('open', () => {
    socket.send(
      JSON.stringify({ type: 'run', code, cols: term.cols, rows: term.rows })
    );
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'status':
        if (msg.status === 'queued') setOutputStatus('en cola…', 'busy');
        else if (msg.status === 'compiling') setOutputStatus('compilando…', 'busy');
        else if (msg.status === 'running') {
          setOutputStatus('ejecutando', 'busy');
          runBtn.disabled = false;
        }
        break;
      case 'compile-warnings':
        term.write(msg.output.replace(/\n/g, '\r\n'));
        break;
      case 'compile-error':
        setOutputStatus('fallo la compilacion', 'err');
        term.write('\x1b[31mError de compilacion:\x1b[0m\r\n');
        term.write((msg.output || msg.message).replace(/\n/g, '\r\n'));
        runBtn.disabled = false;
        break;
      case 'data':
        term.write(msg.data);
        break;
      case 'exit': {
        const reasonText =
          msg.reason === 'idle'
            ? '\r\n\x1b[2m[sesion cerrada por inactividad]\x1b[0m'
            : msg.reason === 'timeout'
              ? '\r\n\x1b[31m[tiempo maximo de ejecucion alcanzado]\x1b[0m'
              : `\r\n\x1b[2m[proceso terminado, codigo ${msg.code}]\x1b[0m`;
        term.write(reasonText);
        setOutputStatus(
          msg.code === 0 ? 'terminado' : `terminado (codigo ${msg.code})`,
          msg.code === 0 ? 'ok' : 'err'
        );
        renderGeneratedFiles(msg.files || [], socket);
        runBtn.disabled = false;
        break;
      }
    }
  });

  const onClose = () => {
    inputDisposable.dispose();
    runBtn.disabled = false;
    if (runSocket === socket) runSocket = null;
  };
  socket.addEventListener('close', onClose);
  socket.addEventListener('error', () => {
    setOutputStatus('error de conexion', 'err');
    term.write('\r\n\x1b[31m[no se pudo conectar con el servidor de ejecucion]\x1b[0m');
  });
}

// ---------------------------------------------------------------------
// Workspace multi-archivo (explorador tipo VS Code, por sala)
// ---------------------------------------------------------------------
function fileYText(name) {
  return currentDoc.getText(`file:${name}`);
}

function fileDotClass(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['h', 'hpp', 'hh'].includes(ext)) return 'header';
  if (['cpp', 'cc', 'cxx', 'c'].includes(ext)) return '';
  return 'other';
}

function createEditorForFile(ytext) {
  if (currentView) currentView.destroy();
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      basicSetup,
      darkPlusTheme,
      syntaxHighlighting(darkPlusHighlight),
      cpp(),
      indentUnit.of('    '),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      cmHistory(),
      yCollab(ytext, currentProvider.awareness),
    ],
  });
  currentView = new EditorView({ state, parent: editorEl });
}

function switchToFile(name) {
  if (!name || name === activeFile) {
    renderFileList();
    return;
  }
  activeFile = name;
  createEditorForFile(fileYText(name));
  renderFileList();
}

function renderFileList() {
  sidebarFileListEl.innerHTML = '';
  if (!filesArray) return;
  for (const name of filesArray.toArray()) {
    const row = document.createElement('div');
    row.className = 'file-row' + (name === activeFile ? ' active' : '');

    const dot = document.createElement('span');
    dot.className = 'file-dot ' + fileDotClass(name);

    const fname = document.createElement('span');
    fname.className = 'fname';
    fname.textContent = name;
    fname.title = name;

    const actions = document.createElement('span');
    actions.className = 'row-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = '✏';
    renameBtn.title = 'Renombrar';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = window.prompt('Nuevo nombre:', name);
      if (next) renameFile(name, next);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '✕';
    delBtn.title = 'Eliminar';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFile(name);
    });

    actions.append(renameBtn, delBtn);
    row.append(dot, fname, actions);
    row.addEventListener('click', () => switchToFile(name));
    sidebarFileListEl.appendChild(row);
  }
}

function createFile(rawName) {
  const name = rawName.trim();
  if (!name) return;
  const names = filesArray.toArray();
  if (names.includes(name)) {
    switchToFile(name);
    return;
  }
  filesArray.push([name]);
  switchToFile(name);
}

function deleteFile(name) {
  const names = filesArray.toArray();
  if (names.length <= 1) {
    window.alert('No podés borrar el único archivo del workspace.');
    return;
  }
  if (!window.confirm(`¿Eliminar "${name}"? Esta accion no se puede deshacer.`)) return;
  const idx = names.indexOf(name);
  if (idx === -1) return;
  const yt = fileYText(name);
  yt.delete(0, yt.length);
  filesArray.delete(idx, 1);
  if (activeFile === name) {
    const remaining = filesArray.toArray();
    switchToFile(remaining[0]);
  } else {
    renderFileList();
  }
}

function renameFile(oldName, rawNewName) {
  const newName = rawNewName.trim();
  if (!newName || newName === oldName) return;
  const names = filesArray.toArray();
  if (names.includes(newName)) {
    window.alert('Ya existe un archivo con ese nombre.');
    return;
  }
  const idx = names.indexOf(oldName);
  if (idx === -1) return;

  const oldText = fileYText(oldName);
  const newText = fileYText(newName);
  newText.insert(0, oldText.toString());
  oldText.delete(0, oldText.length);

  filesArray.delete(idx, 1);
  filesArray.insert(idx, [newName]);

  if (activeFile === oldName) {
    activeFile = newName;
    createEditorForFile(newText);
  }
  renderFileList();
}

function showNewFileRow() {
  newFileRow.classList.add('visible');
  newFileInput.value = '';
  newFileInput.focus();
}
function hideNewFileRow() {
  newFileRow.classList.remove('visible');
}

newFileBtn.addEventListener('click', showNewFileRow);
newFileInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    createFile(newFileInput.value);
    hideNewFileRow();
  } else if (e.key === 'Escape') {
    hideNewFileRow();
  }
});
newFileInput.addEventListener('blur', hideNewFileRow);

// ---------------------------------------------------------------------
// Conexion a la sala
// ---------------------------------------------------------------------
function joinRoom(room) {
  currentRoom = room;
  bootHintEl.classList.remove('hidden');
  bootHintEl.textContent = 'Cargando editor…';
  setStatus('connecting', 'Conectando…');

  if (currentProvider) currentProvider.destroy();
  if (currentDoc) currentDoc.destroy();
  if (currentView) currentView.destroy();
  activeFile = null;
  resetOutputTabs();

  const ydoc = new Y.Doc();
  currentDoc = ydoc;
  filesArray = ydoc.getArray('files');
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(`${wsProtocol}://${location.host}`, `docs/${room}`, ydoc, {
    params: wsAuthParams(),
  });
  currentProvider = provider;

  provider.awareness.setLocalStateField('user', { name: userName, color: userColor, colorLight: userColor + '33' });
  provider.awareness.on('change', () => renderPeers(provider.awareness));
  renderPeers(provider.awareness);

  provider.on('status', ({ status }) => {
    if (status === 'connected') setStatus('connected', 'Conectado');
    else if (status === 'connecting') setStatus('connecting', 'Conectando…');
    else setStatus('offline', 'Desconectado');
  });

  filesArray.observe(() => renderFileList());

  // Solo sembramos contenido una vez que confirmamos con el servidor que el
  // workspace esta vacio, para no pisar/duplicar contenido de otros
  // clientes que se conecten al mismo tiempo. Si hay una version guardada
  // en GitHub para esta sala, arrancamos con esa en vez del ejemplo.
  provider.once('sync', async (isSynced) => {
    if (isSynced && filesArray.length === 0) {
      let seedFiles = [{ name: 'main.cpp', content: DEFAULT_CODE }];
      try {
        const res = await authFetch(`/api/saved/${encodeURIComponent(room)}`);
        const data = await res.json();
        if (Array.isArray(data.files) && data.files.length > 0) seedFiles = data.files;
      } catch {
        // sin conexion con la API de guardado: seguimos con el ejemplo por defecto
      }
      if (filesArray.length === 0) {
        for (const f of seedFiles) {
          filesArray.push([f.name]);
          fileYText(f.name).insert(0, f.content);
        }
      }
    }
    if (!activeFile) {
      const first = filesArray.toArray()[0];
      if (first) switchToFile(first);
    }
    bootHintEl.classList.add('hidden');
  });
}

function startApp() {
  roomInput.value = getRoomFromUrl();
  joinRoom(roomInput.value);

  authFetch('/api/save-status')
    .then((r) => r.json())
    .then(({ enabled }) => {
      if (!enabled) {
        saveBtn.title = 'El guardado en GitHub no esta configurado en este servidor (falta GITHUB_TOKEN/GITHUB_REPO).';
      }
    })
    .catch(() => {});
}

async function boot() {
  try {
    const { required } = await fetch('/api/auth-status').then((r) => r.json());
    if (required && !getToken()) {
      showLogin();
      return;
    }
  } catch {
    // sin conexion: intentamos arrancar igual, joinRoom/authFetch avisaran si falla
  }
  startApp();
}

joinBtn.addEventListener('click', () => {
  const room = roomInput.value.trim() || 'general';
  setRoomInUrl(room);
  joinRoom(room);
});

roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

async function saveCurrentCode() {
  if (!currentDoc || !currentRoom || !filesArray) return;
  const files = filesArray.toArray().map((name) => ({ name, content: fileYText(name).toString() }));

  saveBtn.disabled = true;
  saveBtn.classList.remove('saved', 'save-error');
  saveBtn.textContent = 'Guardando…';

  try {
    const res = await authFetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: currentRoom, files, author: userName }),
    });
    const result = await res.json();
    if (result.ok) {
      saveBtn.textContent = '✓ Guardado';
      saveBtn.classList.add('saved');
    } else {
      saveBtn.textContent = 'Error al guardar';
      saveBtn.classList.add('save-error');
      saveBtn.title = result.message || 'No se pudo guardar en GitHub.';
    }
  } catch {
    saveBtn.textContent = 'Error de red';
    saveBtn.classList.add('save-error');
  } finally {
    saveBtn.disabled = false;
    setTimeout(() => {
      saveBtn.textContent = '💾 Guardar';
      saveBtn.classList.remove('saved', 'save-error');
    }, 2500);
  }
}

shareBtn.addEventListener('click', copyShareLink);
saveBtn.addEventListener('click', saveCurrentCode);
runBtn.addEventListener('click', runCode);
panelToggle.addEventListener('click', () => {
  setPanelCollapsed(!outputPanel.classList.contains('collapsed'));
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runCode();
  }
});

boot();
