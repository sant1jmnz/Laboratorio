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
const outputText = document.getElementById('output-text');
const stdinEl = document.getElementById('stdin');

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

let currentView = null;
let currentProvider = null;
let currentDoc = null;
let runAbortController = null;

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

function renderOutput(result) {
  outputText.innerHTML = '';
  const append = (text, className) => {
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    outputText.appendChild(span);
  };

  if (result.stage === 'validate') {
    append(result.message, 'err-line');
    return;
  }

  if (result.stage === 'compile') {
    append('Error de compilacion:\n', 'err-line');
    append(result.output || result.message);
    return;
  }

  if (result.compileWarnings) {
    append(result.compileWarnings, 'dim-line');
    append('\n');
  }
  if (result.stdout) append(result.stdout);
  if (result.stderr) append(result.stderr, 'err-line');
  if (result.timedOut) append('\n[el programa tardo demasiado y se cancelo]', 'err-line');
  if (result.truncated) append('\n[salida truncada por ser demasiado larga]', 'dim-line');
  if (!result.stdout && !result.stderr && !result.timedOut) {
    append(`(sin salida — el programa termino con codigo ${result.exitCode})`, 'dim-line');
  }
}

async function runCode() {
  if (!currentDoc) return;
  const code = currentDoc.getText('codemirror').toString();

  runAbortController?.abort();
  const controller = new AbortController();
  runAbortController = controller;

  runBtn.disabled = true;
  setPanelCollapsed(false);
  outputStatus.textContent = 'compilando…';
  outputStatus.className = 'busy';
  outputText.textContent = '';

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, stdin: stdinEl.value }),
      signal: controller.signal,
    });
    const result = await res.json();
    renderOutput(result);
    outputStatus.textContent =
      result.stage === 'run' && result.ok
        ? `terminado (codigo ${result.exitCode})`
        : result.stage === 'run'
          ? `termino con error (codigo ${result.exitCode})`
          : 'fallo la compilacion';
    outputStatus.className = result.ok ? 'ok' : 'err';
  } catch (err) {
    if (err.name === 'AbortError') return;
    outputText.textContent = 'No se pudo contactar al servidor para compilar.';
    outputStatus.textContent = 'error de red';
    outputStatus.className = 'err';
  } finally {
    runBtn.disabled = false;
  }
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
