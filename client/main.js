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

const roomInput = document.getElementById('room');
const joinBtn = document.getElementById('join');
const shareBtn = document.getElementById('share');
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
const generatedFilesEl = document.getElementById('generated-files');

const USER_COLORS = ['#4fa6ff', '#7ee787', '#ffbc42', '#f2cc60', '#ff7b72', '#9ac2c9', '#d2a8ff', '#39c5cf'];
const userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
const userName = 'Usuario-' + Math.floor(Math.random() * 1000);

const DEFAULT_CODE = '#include <iostream>\n\nint main() {\n    std::cout << "Hola mundo" << std::endl;\n    return 0;\n}\n';

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
term.writeln('Presioná "▶ Ejecutar" (o Ctrl+Enter) para compilar y correr el código.');
new ResizeObserver(() => fitAddon.fit()).observe(terminalEl);

let currentView = null;
let currentProvider = null;
let currentDoc = null;
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

function downloadBase64(name, base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
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

function renderGeneratedFiles(files, socket) {
  generatedFilesEl.innerHTML = '';
  generatedFilesEl.classList.toggle('visible', files.length > 0);
  for (const file of files) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'file-chip';
    chip.title = `Descargar ${file.name}`;
    chip.innerHTML = `⬇ ${file.name} <span class="file-size">${formatBytes(file.size)}</span>`;
    chip.addEventListener('click', () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      chip.disabled = true;
      const onMessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'file-content' && msg.name === file.name) {
          socket.removeEventListener('message', onMessage);
          chip.disabled = false;
          if (msg.error) {
            setOutputStatus(`no se pudo leer ${file.name}`, 'err');
            return;
          }
          downloadBase64(file.name, msg.base64);
        }
      };
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({ type: 'get-file', name: file.name }));
    });
    generatedFilesEl.appendChild(chip);
  }
}

function runCode() {
  if (!currentDoc) return;
  const code = currentDoc.getText('codemirror').toString();

  runSocket?.close();
  term.reset();
  setPanelCollapsed(false);
  setOutputStatus('conectando…', 'busy');
  renderGeneratedFiles([], null);
  runBtn.disabled = true;

  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${wsProtocol}://${location.host}/run-ws`);
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

function joinRoom(room) {
  bootHintEl.classList.remove('hidden');
  bootHintEl.textContent = 'Cargando editor…';
  setStatus('connecting', 'Conectando…');

  if (currentProvider) currentProvider.destroy();
  if (currentDoc) currentDoc.destroy();
  if (currentView) currentView.destroy();

  const ydoc = new Y.Doc();
  currentDoc = ydoc;
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(`${wsProtocol}://${location.host}`, `docs/${room}`, ydoc);
  currentProvider = provider;

  provider.awareness.setLocalStateField('user', { name: userName, color: userColor, colorLight: userColor + '33' });
  provider.awareness.on('change', () => renderPeers(provider.awareness));
  renderPeers(provider.awareness);

  provider.on('status', ({ status }) => {
    if (status === 'connected') setStatus('connected', 'Conectado');
    else if (status === 'connecting') setStatus('connecting', 'Conectando…');
    else setStatus('offline', 'Desconectado');
  });

  const ytext = ydoc.getText('codemirror');

  // Solo sembramos el contenido por defecto una vez que confirmamos con el
  // servidor que el documento esta vacio, para no pisar/duplicar contenido
  // de otros clientes que se conecten al mismo tiempo.
  provider.once('sync', (isSynced) => {
    if (isSynced && ytext.length === 0) {
      ytext.insert(0, DEFAULT_CODE);
    }
    bootHintEl.classList.add('hidden');
  });

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
      yCollab(ytext, provider.awareness),
    ],
  });

  currentView = new EditorView({ state, parent: editorEl });
}

roomInput.value = getRoomFromUrl();
joinRoom(roomInput.value);

joinBtn.addEventListener('click', () => {
  const room = roomInput.value.trim() || 'general';
  setRoomInUrl(room);
  joinRoom(room);
});

roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

shareBtn.addEventListener('click', copyShareLink);
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
