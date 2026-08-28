import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history as cmHistory, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { java } from '@codemirror/lang-java';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { applyBreakpoints, applyPausedLine, breakpointGutter } from './debug-ui.js';

const loginOverlay = document.getElementById('login-overlay');
const loginCard = document.getElementById('login-card');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const loginSubtitle = document.getElementById('login-subtitle');
const loginSubmit = document.getElementById('login-submit');
const loginSwitchText = document.getElementById('login-switch-text');
const loginSwitchBtn = document.getElementById('login-switch-btn');

const projectsOverlay = document.getElementById('projects-overlay');
const projectsBtn = document.getElementById('projects-btn');
const projectsUserEl = document.getElementById('projects-user');
const logoutBtn = document.getElementById('logout-btn');
const newProjectForm = document.getElementById('new-project-form');
const newProjectName = document.getElementById('new-project-name');
const projectsOwnEl = document.getElementById('projects-own');
const projectsSharedEl = document.getElementById('projects-shared');

const roomInput = document.getElementById('room');
const roomChip = document.getElementById('room-chip');
const roomNameEl = document.getElementById('room-name');
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
const panelResizeHandle = document.getElementById('panel-resize-handle');
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
const langIndicatorEl = document.getElementById('lang-indicator');
const beautifyBtn = document.getElementById('beautify');
const debugBtn = document.getElementById('debug');
const debugToolbar = document.getElementById('debug-toolbar');
const debugStateEl = document.getElementById('debug-state');
const debugPanel = document.getElementById('debug-panel');
const dbgVariablesEl = document.getElementById('dbg-variables');
const dbgFramesEl = document.getElementById('dbg-frames');
const dbgContinueBtn = document.getElementById('dbg-continue');
const dbgNextBtn = document.getElementById('dbg-next');
const dbgStepBtn = document.getElementById('dbg-step');
const dbgFinishBtn = document.getElementById('dbg-finish');
const dbgStopBtn = document.getElementById('dbg-stop');

const USER_COLORS = ['#4fa6ff', '#7ee787', '#ffbc42', '#f2cc60', '#ff7b72', '#9ac2c9', '#d2a8ff', '#39c5cf'];
const userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
const userName = 'Usuario-' + Math.floor(Math.random() * 1000);

const DEFAULT_CODE = '#include <iostream>\n\nint main() {\n    std::cout << "Hola mundo" << std::endl;\n    return 0;\n}\n';

// ---------------------------------------------------------------------
// Cuentas de usuario: cada persona tiene sus proyectos y su historial.
// ---------------------------------------------------------------------
const AUTH_TOKEN_KEY = 'editorAuthToken';
let currentUser = null;
let accountsEnabled = false;
let loginMode = 'login'; // 'login' | 'register'

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
  if (res.status === 401 && accountsEnabled) {
    clearToken();
    currentUser = null;
    showLogin('Tu sesion expiro. Entrá de nuevo.');
  }
  return res;
}

function showLogin(message) {
  loginOverlay.classList.add('visible');
  projectsOverlay.classList.remove('visible');
  loginError.textContent = message || '';
  loginPassword.value = '';
  loginUsername.focus();
}
function hideLogin() {
  loginOverlay.classList.remove('visible');
}

function setLoginMode(mode) {
  loginMode = mode;
  const registering = mode === 'register';
  loginSubtitle.textContent = registering
    ? 'Elegí un usuario y una contraseña para empezar.'
    : 'Entrá con tu cuenta para ver tus proyectos.';
  loginSubmit.textContent = registering ? 'Crear cuenta' : 'Entrar';
  loginSwitchText.textContent = registering ? '¿Ya tenés cuenta?' : '¿No tenés cuenta?';
  loginSwitchBtn.textContent = registering ? 'Entrar' : 'Crear una';
  loginPassword.autocomplete = registering ? 'new-password' : 'current-password';
  loginError.textContent = '';
}

loginSwitchBtn.addEventListener('click', () => {
  setLoginMode(loginMode === 'login' ? 'register' : 'login');
  loginUsername.focus();
});

loginCard.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginSubmit.disabled = true;
  try {
    const res = await fetch(loginMode === 'register' ? '/api/register' : '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUsername.value.trim(), password: loginPassword.value }),
    });
    const data = await res.json();
    if (data.ok) {
      setToken(data.token);
      currentUser = data.user;
      hideLogin();
      await afterLogin();
    } else {
      loginError.textContent = data.message || 'No se pudo entrar.';
    }
  } catch {
    loginError.textContent = 'Error de red.';
  } finally {
    loginSubmit.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  clearToken();
  currentUser = null;
  currentProvider?.destroy();
  currentProvider = null;
  projectsOverlay.classList.remove('visible');
  setLoginMode('login');
  showLogin();
});

// Colores del tema "Dark+" de VS Code
const darkPlusTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#1c1c1e', color: '#d4d4d4', height: '100%' },
    '.cm-content': { caretColor: '#0a84ff', padding: '14px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#0a84ff', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(10, 132, 255, 0.32)',
    },
    '.cm-gutters': {
      backgroundColor: '#1c1c1e',
      color: '#6a6a70',
      border: 'none',
      paddingRight: '4px',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.045)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#f2f2f7' },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(255, 255, 255, 0.12)',
      outline: '1px solid rgba(255, 255, 255, 0.25)',
      borderRadius: '3px',
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
  fontWeight: '400',
  lineHeight: 1.35,
  cursorBlink: true,
  theme: {
    background: '#1c1c1e',
    foreground: '#e5e5ea',
    cursor: '#0a84ff',
    selectionBackground: 'rgba(10, 132, 255, 0.32)',
    red: '#ff453a',
    green: '#30d158',
    yellow: '#ffd60a',
    blue: '#0a84ff',
    magenta: '#bf5af2',
    cyan: '#64d2ff',
  },
});
let currentView = null;
let currentProvider = null;
let currentDoc = null;
let currentRoom = null;
let filesArray = null;
let activeFile = null;
let runSocket = null;

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(terminalEl);

// fit() mide en celdas, asi que hasta que la fuente monoespaciada no esta
// cargada calcula mal el ancho y la terminal queda desbordada. Reajustamos
// cuando las fuentes terminan de cargar y ante cualquier cambio de tamaño.
function fitTerminal() {
  try { fitAddon.fit(); } catch { /* el panel puede estar colapsado */ }
  // El proceso del otro lado necesita saber el tamaño real de la terminal
  // para que el wrapping de su salida coincida con lo que se ve.
  if (runSocket?.readyState === WebSocket.OPEN) {
    runSocket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }
}
fitTerminal();
document.fonts?.ready.then(fitTerminal);
term.writeln('Presioná "▶ Ejecutar" (o Ctrl+Enter) para compilar y correr el archivo activo.');
new ResizeObserver(fitTerminal).observe(terminalEl);
window.addEventListener('resize', fitTerminal);

// ---------------------------------------------------------------------
// Proyectos: cada uno tiene su ID unico y vive en /p/<id>.
// ---------------------------------------------------------------------
let currentProject = null; // { id, name, ownerName, isOwner }

function projectIdFromUrl() {
  const match = location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function setProjectInUrl(id) {
  window.history.pushState({}, '', `/p/${id}`);
}

function projectLink(id) {
  return `${location.origin}/p/${id}`;
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
  const link = currentProject ? projectLink(currentProject.id) : location.href;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    // Sin portapapeles (permiso denegado, http sin TLS): al menos se lo
    // mostramos para que lo copie a mano.
    window.prompt('Copiá este link para compartir el proyecto:', link);
    return;
  }
  shareBtn.textContent = '¡Copiado!';
  shareBtn.classList.add('copied');
  setTimeout(() => {
    shareBtn.textContent = 'Compartir';
    shareBtn.classList.remove('copied');
  }, 1500);
}

// ---------------------------------------------------------------------
// Spring critico (parametros al estilo SwiftUI: response + dampingRatio en
// vez de masa/rigidez/friccion crudas). Es interrumpible: "to()" siempre
// arranca desde el valor actual, nunca del target logico, asi que se puede
// re-apuntar a mitad de la animacion sin que el panel salte.
// Ver skill apple-design, "Interruptibilidad" y "Comportamiento sobre animacion".
// ---------------------------------------------------------------------
function createSpring(initial, onUpdate) {
  let value = initial;
  let velocity = 0;
  let target = initial;
  let dampingRatio = 1;
  let response = 0.32;
  let rafId = null;

  function step() {
    const omega = (2 * Math.PI) / response;
    const k = omega * omega;
    const c = 2 * dampingRatio * omega;
    const dt = 1 / 60;
    const accel = -k * (value - target) - c * velocity;
    velocity += accel * dt;
    value += velocity * dt;
    onUpdate(value);
    if (Math.abs(value - target) < 0.5 && Math.abs(velocity) < 0.5) {
      value = target;
      onUpdate(value);
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(step);
  }

  return {
    to(newTarget, { velocity: v, dampingRatio: d = 1, response: r = 0.32 } = {}) {
      target = newTarget;
      dampingRatio = d;
      response = r;
      if (v !== undefined) velocity = v;
      if (!rafId) rafId = requestAnimationFrame(step);
    },
    // Corta el spring y fija el valor de una: lo que usamos mientras el
    // dedo/mouse arrastra el panel 1:1, sin ninguna animacion de por medio.
    jump(newValue) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      value = newValue;
      target = newValue;
      velocity = 0;
      onUpdate(value);
    },
    get value() {
      return value;
    },
  };
}

// Resistencia progresiva al pasar un limite: cuanto mas te alejas, menos
// seguis al puntero, en vez de frenar en seco. Formula de la skill apple-design.
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// Proyecta donde terminaria de asentarse un gesto si siguiera frenando solo,
// igual que el scroll con inercia (misma formula que usa iOS internamente).
function projectMomentum(velocityPxPerSec, decelerationRate = 0.998) {
  return (velocityPxPerSec / 1000) * (decelerationRate / (1 - decelerationRate));
}

const PANEL_COLLAPSED_HEIGHT = 36;
const PANEL_MIN_HEIGHT = 120;
let panelExpandedHeight = 230; // ultima altura "abierta" que se recuerda

function panelMaxHeight() {
  return Math.max(PANEL_MIN_HEIGHT, window.innerHeight - 260);
}

const panelSpring = createSpring(outputPanel.getBoundingClientRect().height || 230, (h) => {
  outputPanel.style.height = `${h}px`;
  outputPanel.classList.toggle('collapsed', h <= PANEL_COLLAPSED_HEIGHT + 4);
});

function isPanelCollapsed() {
  return outputPanel.classList.contains('collapsed');
}

function setPanelCollapsed(collapsed, { velocity = 0 } = {}) {
  const target = collapsed
    ? PANEL_COLLAPSED_HEIGHT
    : Math.min(panelExpandedHeight, panelMaxHeight());
  panelSpring.to(target, { velocity, dampingRatio: 1, response: 0.32 });
}

// Arrastrar el borde superior del panel lo redimensiona en vivo (1:1, sin
// spring de por medio); al soltar, la velocidad del gesto se proyecta hacia
// adelante -como el scroll con inercia- para decidir el destino, y esa misma
// velocidad se le pasa al spring para que la transicion sea continua, sin
// costura entre "arrastrar" y "animar".
panelResizeHandle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  panelResizeHandle.setPointerCapture(e.pointerId);
  const startY = e.clientY;
  const startHeight = outputPanel.getBoundingClientRect().height;
  const min = PANEL_MIN_HEIGHT;
  const max = panelMaxHeight();
  let history = [{ y: e.clientY, t: performance.now() }];

  function onMove(ev) {
    const dy = startY - ev.clientY; // arrastrar hacia arriba agranda el panel
    let h = startHeight + dy;
    if (h < min) h = min - rubberband(min - h, 60);
    else if (h > max) h = max + rubberband(h - max, 60);
    panelSpring.jump(Math.max(4, h));
    history.push({ y: ev.clientY, t: performance.now() });
    if (history.length > 6) history.shift();
  }

  function onUp() {
    panelResizeHandle.releasePointerCapture(e.pointerId);
    panelResizeHandle.removeEventListener('pointermove', onMove);
    panelResizeHandle.removeEventListener('pointerup', onUp);

    const first = history[0];
    const last = history[history.length - 1];
    const dt = Math.max(1, last.t - first.t) / 1000;
    const heightVelocity = (first.y - last.y) / dt; // px/s; positivo = agrandando

    const projected = panelSpring.value + projectMomentum(heightVelocity);

    if (projected < min * 0.55) {
      panelSpring.to(PANEL_COLLAPSED_HEIGHT, { velocity: heightVelocity, dampingRatio: 1, response: 0.32 });
    } else {
      const targetHeight = Math.min(max, Math.max(min, projected));
      panelExpandedHeight = targetHeight;
      panelSpring.to(targetHeight, { velocity: heightVelocity, dampingRatio: 0.86, response: 0.34 });
    }
  }

  panelResizeHandle.addEventListener('pointermove', onMove);
  panelResizeHandle.addEventListener('pointerup', onUp);
});

panelResizeHandle.addEventListener('dblclick', () => {
  if (!isPanelCollapsed()) panelExpandedHeight = panelSpring.value;
  setPanelCollapsed(!isPanelCollapsed());
});

window.addEventListener('resize', () => {
  if (!isPanelCollapsed() && panelSpring.value > panelMaxHeight()) {
    panelSpring.jump(panelMaxHeight());
  }
});

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

// Iconos SVG lineales (estilo SF Symbols) para los botones que antes usaban
// un glifo Unicode como "icono" (✕, ✏): el markup es estatico y de confianza,
// nunca contiene datos del usuario, asi que innerHTML es seguro aca.
const ICON_X =
  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_PENCIL =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';

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
      const cached = { size: msg.size, truncated: msg.truncated, bytes, isText: text !== null, text };
      outputFileCache.set(name, cached);
      syncGeneratedFileToExplorer(name, cached);
    }
    if (activeOutputTab === name) showOutputTab(name);
  };
  socket.addEventListener('message', onMessage);
  socket.send(JSON.stringify({ type: 'get-file', name }));
}

// El servidor borra el directorio de una corrida (y lo que el programa haya
// generado, ej. Productos.txt via ofstream) unos minutos despues de que
// termina. Para que no se pierda, los archivos generados de texto se
// escriben tambien como un archivo mas del explorador colaborativo: quedan
// en el mismo documento Yjs que main.cpp (persistido en Postgres), visibles
// para todos en el proyecto, y sobreviven a que esa sesion de ejecucion expire.
const GENERATED_SYNC_MAX_BYTES = 512 * 1024;

function syncGeneratedFileToExplorer(name, cached) {
  if (!currentDoc || !filesArray) return;
  if (!cached.isText || cached.truncated || cached.size > GENERATED_SYNC_MAX_BYTES) return;
  currentDoc.transact(() => {
    if (!filesArray.toArray().includes(name)) filesArray.push([name]);
    replaceYText(fileYText(name), cached.text);
  });
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
  closeSpan.innerHTML = ICON_X;
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
  if (files.length > 0 && activeOutputTab === null) showOutputTab(files[0].name);
  // Se piden todos (no solo el que se esta mostrando) para que la
  // sincronizacion al explorador -ver syncGeneratedFileToExplorer- no
  // dependa de que alguien abra la pestaña de cada archivo generado.
  for (const file of files) fetchOutputFileContent(socket, file.name);
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
      JSON.stringify({ type: 'run', code, fileName: activeFile, cols: term.cols, rows: term.rows })
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
// Formatear el archivo activo
// ---------------------------------------------------------------------
let formatExtensions = [];

function updateFormatAvailability(name) {
  const can = formatExtensions.length === 0 || formatExtensions.includes(extOf(name));
  beautifyBtn.disabled = !can;
  beautifyBtn.title = can
    ? 'Ordenar la indentación y los espacios (Shift+Alt+F)'
    : 'No hay formateador para este tipo de archivo.';
}

/**
 * Reemplaza el contenido de un Y.Text por otro, tocando solo el tramo que
 * de verdad cambio (descarta el prefijo y el sufijo en comun).
 *
 * Importa porque borrar e insertar todo el archivo mandaria el documento
 * entero por la red y mandaria al principio los cursores de los demas, aun
 * cuando el formateo casi no cambio nada.
 */
function replaceYText(ytext, next) {
  const current = ytext.toString();
  if (current === next) return false;

  let start = 0;
  const maxStart = Math.min(current.length, next.length);
  while (start < maxStart && current[start] === next[start]) start++;

  let end = 0;
  const maxEnd = Math.min(current.length - start, next.length - start);
  while (end < maxEnd && current[current.length - 1 - end] === next[next.length - 1 - end]) end++;

  const deleteLength = current.length - start - end;
  const inserted = next.slice(start, next.length - end);

  currentDoc.transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (inserted) ytext.insert(start, inserted);
  });
  return true;
}

function flashButton(btn, text, ms = 1800) {
  const original = btn.dataset.label ?? btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = btn.dataset.label ?? original;
  }, ms);
}

async function beautifyCode() {
  if (!currentDoc || !activeFile || beautifyBtn.disabled) return;
  const ytext = fileYText(activeFile);

  beautifyBtn.disabled = true;
  flashButton(beautifyBtn, 'Formateando…', 60_000);
  try {
    const res = await authFetch('/api/format', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ytext.toString(), fileName: activeFile }),
    });
    const data = await res.json();
    if (data.ok) {
      flashButton(beautifyBtn, replaceYText(ytext, data.code) ? '✓ Formateado' : 'Ya estaba ordenado');
    } else {
      flashButton(beautifyBtn, 'No se pudo');
      setOutputStatus(data.message || 'no se pudo formatear', 'err');
      setPanelCollapsed(false);
      term.write(`\r\n\x1b[31m${data.message}\x1b[0m\r\n`);
      if (data.output) term.write(data.output.replace(/\n/g, '\r\n'));
    }
  } catch {
    flashButton(beautifyBtn, 'Error de red');
  } finally {
    beautifyBtn.disabled = false;
  }
}

beautifyBtn.addEventListener('click', beautifyCode);

// ---------------------------------------------------------------------
// Depurador (GDB por WebSocket)
// ---------------------------------------------------------------------
let debugSocket = null;
// Breakpoints por archivo, para que sobrevivan al cambiar de pestaña.
const breakpointsByFile = new Map();

function onBreakpointToggled(line, active) {
  if (!activeFile) return;
  const set = breakpointsByFile.get(activeFile) ?? new Set();
  if (active) set.add(line);
  else set.delete(line);
  breakpointsByFile.set(activeFile, set);

  // Si hay una sesion viva, el cambio se aplica en caliente.
  if (debugSocket?.readyState === WebSocket.OPEN) {
    debugSocket.send(JSON.stringify({ type: active ? 'set-breakpoint' : 'remove-breakpoint', line }));
  }
}

function setDebugUiActive(active) {
  debugToolbar.classList.toggle('visible', active);
  debugPanel.classList.toggle('visible', active);
  debugBtn.classList.toggle('active', active);
  debugBtn.textContent = active ? 'Depurando' : 'Depurar';
  runBtn.disabled = active;
  if (!active) {
    applyPausedLine(currentView, null);
    dbgVariablesEl.innerHTML = '';
    dbgFramesEl.innerHTML = '';
  }
}

function setDebugControlsEnabled(enabled) {
  for (const b of [dbgContinueBtn, dbgNextBtn, dbgStepBtn, dbgFinishBtn]) b.disabled = !enabled;
}

function renderDebugState(paused) {
  dbgVariablesEl.innerHTML = '';
  dbgFramesEl.innerHTML = '';

  if (paused.variables.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dbg-empty';
    empty.textContent = 'sin variables en este ambito';
    dbgVariablesEl.appendChild(empty);
  }
  for (const v of paused.variables) {
    const row = document.createElement('div');
    row.className = 'dbg-var';
    const name = document.createElement('span');
    name.className = 'v-name' + (v.isArg ? ' arg' : '');
    name.textContent = v.name;
    const value = document.createElement('span');
    value.className = 'v-value';
    value.textContent = v.value;
    value.title = `${v.name} = ${v.value}`;
    row.append(name, value);
    dbgVariablesEl.appendChild(row);
  }

  for (const f of paused.frames) {
    const row = document.createElement('div');
    row.className = 'dbg-frame' + (f.level === 0 ? ' top' : '');
    const fn = document.createElement('span');
    fn.className = 'f-func';
    fn.textContent = f.func + '()';
    const ln = document.createElement('span');
    ln.className = 'f-line';
    ln.textContent = f.line ? `:${f.line}` : '';
    row.append(fn, ln);
    dbgFramesEl.appendChild(row);
  }
}

function stopDebugging() {
  if (debugSocket?.readyState === WebSocket.OPEN) {
    debugSocket.send(JSON.stringify({ type: 'stop' }));
  }
  debugSocket?.close();
  debugSocket = null;
  setDebugUiActive(false);
}

function startDebugging() {
  if (!currentDoc || !activeFile) return;
  if (debugSocket) {
    stopDebugging();
    return;
  }

  const code = fileYText(activeFile).toString();
  const breakpoints = [...(breakpointsByFile.get(activeFile) ?? [])];

  term.reset();
  setPanelCollapsed(false);
  setOutputStatus('iniciando depuracion…', 'busy');
  resetOutputTabs();
  setDebugUiActive(true);
  setDebugControlsEnabled(false);
  debugStateEl.textContent = 'Compilando…';
  debugStateEl.className = 'dbg-state running';

  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const qs = new URLSearchParams(wsAuthParams()).toString();
  const socket = new WebSocket(`${wsProtocol}://${location.host}/debug-ws${qs ? '?' + qs : ''}`);
  debugSocket = socket;

  const inputDisposable = term.onData((data) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input', data }));
    }
  });

  socket.addEventListener('open', () => {
    socket.send(
      JSON.stringify({
        type: 'start',
        code,
        fileName: activeFile,
        breakpoints,
        cols: term.cols,
        rows: term.rows,
      })
    );
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'status':
        if (msg.status === 'queued') { setOutputStatus('en cola…', 'busy'); debugStateEl.textContent = 'En cola…'; }
        else if (msg.status === 'compiling') { setOutputStatus('compilando…', 'busy'); debugStateEl.textContent = 'Compilando…'; }
        else if (msg.status === 'started') setOutputStatus('depurando', 'busy');
        else if (msg.status === 'running') {
          debugStateEl.textContent = 'Ejecutando…';
          debugStateEl.className = 'dbg-state running';
          setDebugControlsEnabled(false);
          applyPausedLine(currentView, null);
        }
        break;

      case 'compile-warnings':
        term.write(msg.output.replace(/\n/g, '\r\n'));
        break;

      case 'compile-error':
        setOutputStatus('fallo la compilacion', 'err');
        term.write('\x1b[31mError de compilacion:\x1b[0m\r\n');
        term.write((msg.output || msg.message).replace(/\n/g, '\r\n'));
        setDebugUiActive(false);
        break;

      case 'debug-error':
        setOutputStatus('error del debugger', 'err');
        term.write(`\r\n\x1b[31m${msg.message}\x1b[0m`);
        setDebugUiActive(false);
        break;

      case 'data':
        // GDB avisa por la tty del programa que no pudo tomar el control de
        // la terminal; es inofensivo y solo ensucia la salida.
        term.write(String(msg.data).replace(/&"warning: GDB: Failed to set controlling terminal[^"]*"\r?\n/g, ''));
        break;

      case 'paused':
        debugStateEl.textContent = `Pausado · linea ${msg.line ?? '?'}`;
        debugStateEl.className = 'dbg-state';
        setOutputStatus('pausado', 'warn');
        setDebugControlsEnabled(true);
        applyPausedLine(currentView, msg.line);
        renderDebugState(msg);
        break;

      case 'breakpoints':
        if (activeFile) breakpointsByFile.set(activeFile, new Set(msg.lines));
        applyBreakpoints(currentView, msg.lines);
        break;

      case 'exit': {
        const reason =
          msg.reason === 'idle' ? '[sesion cerrada por inactividad]'
          : msg.reason === 'timeout' ? '[tiempo maximo de depuracion alcanzado]'
          : msg.reason === 'detenido' ? '[depuracion detenida]'
          : `[programa terminado, codigo ${msg.code}]`;
        term.write(`\r\n\x1b[2m${reason}\x1b[0m`);
        setOutputStatus(msg.code === 0 ? 'terminado' : 'terminado con error', msg.code === 0 ? 'ok' : 'err');
        setDebugUiActive(false);
        break;
      }
    }
  });

  socket.addEventListener('close', () => {
    inputDisposable.dispose();
    if (debugSocket === socket) {
      debugSocket = null;
      setDebugUiActive(false);
    }
  });
  socket.addEventListener('error', () => {
    setOutputStatus('error de conexion', 'err');
    term.write('\r\n\x1b[31m[no se pudo conectar con el debugger]\x1b[0m');
  });
}

function debugCommand(type) {
  if (debugSocket?.readyState === WebSocket.OPEN) {
    setDebugControlsEnabled(false);
    debugSocket.send(JSON.stringify({ type }));
  }
}

debugBtn.addEventListener('click', startDebugging);
dbgContinueBtn.addEventListener('click', () => debugCommand('continue'));
dbgNextBtn.addEventListener('click', () => debugCommand('next'));
dbgStepBtn.addEventListener('click', () => debugCommand('step'));
dbgFinishBtn.addEventListener('click', () => debugCommand('finish'));
dbgStopBtn.addEventListener('click', stopDebugging);

// ---------------------------------------------------------------------
// Workspace multi-archivo (explorador tipo VS Code, por sala)
// ---------------------------------------------------------------------
function fileYText(name) {
  return currentDoc.getText(`file:${name}`);
}

function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

// Modo de sintaxis de CodeMirror segun la extension. Los headers de C/C++
// no se ejecutan solos pero se editan con el mismo modo que el .cpp.
const SYNTAX_MODES = {
  '.cpp': cpp, '.cc': cpp, '.cxx': cpp, '.c++': cpp,
  '.c': cpp, '.h': cpp, '.hpp': cpp, '.hh': cpp,
  '.py': python,
  '.js': javascript, '.mjs': javascript,
  '.java': java,
};

function syntaxForFile(name) {
  const mode = SYNTAX_MODES[extOf(name)];
  return mode ? [mode()] : [];
}

// Etiqueta del lenguaje para la barra de estado; se completa con lo que
// reporta /api/languages, con un fallback razonable si todavia no cargo.
let languageCatalog = [];
function languageLabelFor(name) {
  const ext = extOf(name);
  const found = languageCatalog.find((l) => l.extensions.includes(ext));
  if (found) return found.label;
  if (['.h', '.hpp', '.hh'].includes(ext)) return 'Header C/C++';
  return ext ? ext.slice(1).toUpperCase() : 'Texto';
}

// El debugger es GDB, asi que solo aplica a los lenguajes compilados
// nativos (C/C++). Para el resto el boton se deshabilita explicando por que.
function updateDebugAvailability(name) {
  const ext = extOf(name);
  const lang = languageCatalog.find((l) => l.extensions.includes(ext));
  const canDebug = lang ? lang.debuggable : ['.c', '.cpp', '.cc', '.cxx'].includes(ext);
  debugBtn.disabled = !canDebug;
  debugBtn.title = canDebug
    ? 'Depurar con breakpoints (F5)'
    : `El debugger todavia solo soporta C y C++${lang ? ` (este archivo es ${lang.name})` : ''}.`;
}

function fileDotClass(name) {
  const ext = extOf(name);
  if (['.h', '.hpp', '.hh'].includes(ext)) return 'header';
  if (SYNTAX_MODES[ext]) return '';
  return 'other';
}

function createEditorForFile(ytext, fileName) {
  if (currentView) currentView.destroy();
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      // Antes de basicSetup para que la canaleta de breakpoints quede a la
      // izquierda de los numeros de linea, como en VS Code.
      breakpointGutter(onBreakpointToggled),
      basicSetup,
      darkPlusTheme,
      syntaxHighlighting(darkPlusHighlight),
      ...syntaxForFile(fileName),
      indentUnit.of('    '),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      cmHistory(),
      yCollab(ytext, currentProvider.awareness),
    ],
  });
  currentView = new EditorView({ state, parent: editorEl });
}

function switchToFile(name) {
  showOutputTab(null); // elegir un archivo fuente cierra el visor de generados, que tapa el editor
  if (!name || name === activeFile) {
    renderFileList();
    return;
  }
  activeFile = name;
  createEditorForFile(fileYText(name), name);
  langIndicatorEl.textContent = languageLabelFor(name);
  updateDebugAvailability(name);
  updateFormatAvailability(name);
  applyBreakpoints(currentView, [...(breakpointsByFile.get(name) ?? [])]);
  bootHintEl.classList.add('hidden');
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
    renameBtn.innerHTML = ICON_PENCIL;
    renameBtn.title = 'Renombrar';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = window.prompt('Nuevo nombre:', name);
      if (next) renameFile(name, next);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.innerHTML = ICON_X;
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
  // En una sola transaccion: los demas ven un unico cambio, no un estado
  // intermedio raro.
  currentDoc.transact(() => {
    const yt = fileYText(name);
    yt.delete(0, yt.length);
    filesArray.delete(idx, 1);
  });
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

  const newText = fileYText(newName);
  // Todo el renombrado va en una transaccion. Si el borrado y el alta
  // viajaran por separado, los demas verian un instante con la lista
  // incompleta y el que tuviera abierto ese archivo se quedaria sin ninguno.
  currentDoc.transact(() => {
    const oldText = fileYText(oldName);
    newText.insert(0, oldText.toString());
    oldText.delete(0, oldText.length);
    filesArray.delete(idx, 1);
    filesArray.insert(idx, [newName]);
  });

  if (activeFile === oldName) {
    activeFile = newName;
    createEditorForFile(newText, newName);
    langIndicatorEl.textContent = languageLabelFor(newName);
    updateDebugAvailability(newName);
    updateFormatAvailability(newName);
  }
  renderFileList();
}

function showNewFileRow() {
  newFileRow.classList.add('visible');
  newFileInput.value = '';
  newFileInput.focus();
}

/**
 * Cierra la fila de "archivo nuevo".
 *
 * Por defecto confirma lo que se haya escrito: si alguien tipea el nombre y
 * hace click en el editor para empezar a programar (en vez de apretar
 * Enter), lo esperable es que el archivo quede creado, no que se pierda en
 * silencio. Con Escape sí se descarta.
 */
function hideNewFileRow({ confirm = true } = {}) {
  const name = newFileInput.value;
  newFileInput.value = '';
  newFileRow.classList.remove('visible');
  if (confirm && name.trim()) createFile(name);
}

newFileBtn.addEventListener('click', () => {
  // Si ya estaba abierta, el segundo click la cierra en vez de no hacer nada.
  if (newFileRow.classList.contains('visible')) hideNewFileRow();
  else showNewFileRow();
});

newFileInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    hideNewFileRow();
  } else if (e.key === 'Escape') {
    hideNewFileRow({ confirm: false });
  }
});
// Envuelto a proposito: el listener recibe el evento como argumento y no
// queremos que se cuele como opciones de hideNewFileRow.
newFileInput.addEventListener('blur', () => hideNewFileRow());

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

  filesArray.observe(() => {
    // Si otra persona borro o renombro el archivo que estabas viendo, el
    // editor quedaria enganchado a un documento que ya no existe: seguirias
    // escribiendo y nadie lo veria. Saltamos al primer archivo disponible.
    const names = filesArray.toArray();
    const orphaned = activeFile && !names.includes(activeFile);

    if ((orphaned || !activeFile) && names.length > 0) {
      switchToFile(names[0]);
      return;
    }
    if (orphaned) {
      activeFile = null;
      currentView?.destroy();
      currentView = null;
      bootHintEl.textContent = 'No quedan archivos. Creá uno con el + del explorador.';
      bootHintEl.classList.remove('hidden');
    }
    renderFileList();
  });

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

// ---------------------------------------------------------------------
// Panel "Mis proyectos"
// ---------------------------------------------------------------------
function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function projectRow(p, { shared }) {
  const row = document.createElement('div');
  row.className = 'project-row';

  const main = document.createElement('div');
  main.className = 'project-main';
  const name = document.createElement('div');
  name.className = 'project-name';
  name.textContent = p.name;
  const meta = document.createElement('div');
  meta.className = 'project-meta';
  meta.textContent = shared
    ? `${p.id} · de ${p.owner_name}`
    : `${p.id} · ${formatDate(p.updated_at)}`;
  main.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'project-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Link';
  copyBtn.title = 'Copiar el link para compartir';
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(projectLink(p.id));
      copyBtn.textContent = '¡Copiado!';
      setTimeout(() => { copyBtn.textContent = 'Link'; }, 1400);
    } catch {
      window.prompt('Copiá este link:', projectLink(p.id));
    }
  });
  actions.appendChild(copyBtn);

  if (!shared) {
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = 'Renombrar';
    renameBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = window.prompt('Nuevo nombre:', p.name);
      if (!next) return;
      await authFetch(`/api/projects/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      if (currentProject?.id === p.id) setProjectName(next.trim());
      loadProjects();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = 'Borrar';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!window.confirm(`¿Borrar "${p.name}"? Se pierde todo su contenido.`)) return;
      await authFetch(`/api/projects/${p.id}`, { method: 'DELETE' });
      loadProjects();
    });
    actions.append(renameBtn, delBtn);
  }

  row.append(main, actions);
  row.addEventListener('click', () => openProject(p.id));
  return row;
}

async function loadProjects() {
  try {
    const res = await authFetch('/api/projects');
    const data = await res.json();
    if (!data.ok) return;
    projectsOwnEl.innerHTML = '';
    projectsSharedEl.innerHTML = '';
    for (const p of data.own) projectsOwnEl.appendChild(projectRow(p, { shared: false }));
    for (const p of data.shared) projectsSharedEl.appendChild(projectRow(p, { shared: true }));
  } catch {
    // sin conexion: dejamos las listas como estaban
  }
}

function showProjects() {
  projectsOverlay.classList.add('visible');
  projectsUserEl.textContent = currentUser ? `@${currentUser.username}` : '';
  loadProjects();
}

function hideProjects() {
  projectsOverlay.classList.remove('visible');
}

projectsBtn.addEventListener('click', showProjects);

projectsOverlay.addEventListener('click', (e) => {
  // Click afuera de la tarjeta cierra, pero solo si ya hay un proyecto abierto.
  if (e.target === projectsOverlay && currentProject) hideProjects();
});

newProjectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = newProjectName.value.trim();
  newProjectName.value = '';
  try {
    const res = await authFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.ok) openProject(data.project.id);
  } catch {
    // sin conexion: no se crea nada
  }
});

// ---------------------------------------------------------------------
// Abrir un proyecto
// ---------------------------------------------------------------------
function setProjectName(name) {
  if (currentProject) currentProject.name = name;
  roomNameEl.textContent = name;
  roomChip.title = currentProject?.isOwner
    ? 'Click para renombrar el proyecto'
    : `Proyecto de ${currentProject?.ownerName ?? 'otra persona'}`;
  document.title = `${name} · Editor colaborativo`;
}

async function openProject(id) {
  try {
    const res = await authFetch(`/api/projects/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!data.ok) {
      if (res.status === 404) {
        window.alert('Ese proyecto no existe o fue borrado.');
        showProjects();
      }
      return;
    }
    currentProject = data.project;
    setProjectInUrl(id);
    setProjectName(data.project.name);
    hideProjects();
    joinRoom(id);
  } catch {
    // sin conexion: no abrimos nada
  }
}

function startApp() {
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      languageCatalog = cfg.languages || [];
      formatExtensions = cfg.formatExtensions || [];
      if (activeFile) {
        langIndicatorEl.textContent = languageLabelFor(activeFile);
        updateDebugAvailability(activeFile);
        updateFormatAvailability(activeFile);
      }
    })
    .catch(() => {});

  authFetch('/api/save-status')
    .then((r) => r.json())
    .then(({ enabled }) => {
      if (!enabled) {
        saveBtn.title = 'El guardado en GitHub no esta configurado en este servidor (falta GITHUB_TOKEN/GITHUB_REPO).';
      }
    })
    .catch(() => {});
}

/** Con la sesion ya iniciada: abre el proyecto del link, o el listado. */
async function afterLogin() {
  startApp();
  const fromUrl = projectIdFromUrl();
  if (fromUrl) await openProject(fromUrl);
  else showProjects();
}

async function boot() {
  let config;
  try {
    config = await fetch('/api/config').then((r) => r.json());
  } catch {
    config = { accounts: false };
  }
  accountsEnabled = Boolean(config.accounts);

  if (!accountsEnabled) {
    // Servidor sin base de datos: modo suelto, sin cuentas ni proyectos.
    projectsBtn.hidden = true;
    currentProject = { id: 'demo', name: 'Sin base de datos', isOwner: true };
    setProjectName('Sin base de datos');
    startApp();
    joinRoom('demo');
    return;
  }

  if (!getToken()) {
    setLoginMode('login');
    showLogin();
    return;
  }

  try {
    const res = await authFetch('/api/me');
    const data = await res.json();
    if (!data.ok) throw new Error('sesion invalida');
    currentUser = data.user;
    await afterLogin();
  } catch {
    clearToken();
    setLoginMode('login');
    showLogin();
  }
}

// El chip muestra el nombre del proyecto; el dueño puede renombrarlo ahi.
function openRoomEditor() {
  if (!currentProject?.isOwner) return;
  roomInput.value = currentProject.name;
  roomInput.hidden = false;
  roomChip.hidden = true;
  roomInput.focus();
  roomInput.select();
}

function closeRoomEditor() {
  roomInput.hidden = true;
  roomChip.hidden = false;
}

async function commitRename() {
  const name = roomInput.value.trim();
  closeRoomEditor();
  if (!name || !currentProject || name === currentProject.name) return;
  await authFetch(`/api/projects/${currentProject.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  setProjectName(name);
}

roomChip.addEventListener('click', openRoomEditor);
roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitRename();
  else if (e.key === 'Escape') closeRoomEditor();
});
roomInput.addEventListener('blur', closeRoomEditor);

// Volver/adelante del navegador entre proyectos.
window.addEventListener('popstate', () => {
  const id = projectIdFromUrl();
  if (id && id !== currentProject?.id) openProject(id);
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
  const collapsed = isPanelCollapsed();
  if (!collapsed) panelExpandedHeight = panelSpring.value;
  setPanelCollapsed(!collapsed);
});

// Atajos globales, con los mismos bindings que VS Code para depurar.
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runCode();
    return;
  }
  if (e.shiftKey && e.altKey && (e.key === 'F' || e.key === 'f')) {
    e.preventDefault();
    beautifyCode();
    return;
  }
  if (e.key === 'F5') {
    e.preventDefault();
    if (!debugSocket) startDebugging();
    else debugCommand('continue');
    return;
  }
  if (!debugSocket) return;
  if (e.key === 'F8') { e.preventDefault(); debugCommand('continue'); }
  else if (e.key === 'F10') { e.preventDefault(); debugCommand('next'); }
  else if (e.key === 'F11') { e.preventDefault(); debugCommand(e.shiftKey ? 'finish' : 'step'); }
});

boot();
