import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';

const roomInput = document.getElementById('room');
const joinBtn = document.getElementById('join');
const peersEl = document.getElementById('peers');
const editorEl = document.getElementById('editor');

const USER_COLORS = ['#30bced', '#6eeb83', '#ffbc42', '#ecd444', '#ee6352', '#9ac2c9', '#8acb88', '#1be7ff'];
const userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
const userName = 'Usuario-' + Math.floor(Math.random() * 1000);

let currentView = null;
let currentProvider = null;

function getRoomFromUrl() {
  const params = new URLSearchParams(location.search);
  return params.get('room') || 'general';
}

function setRoomInUrl(room) {
  const url = new URL(location.href);
  url.searchParams.set('room', room);
  history.pushState({}, '', url);
}

function joinRoom(room) {
  if (currentProvider) {
    currentProvider.destroy();
  }
  if (currentView) {
    currentView.destroy();
  }

  const ydoc = new Y.Doc();
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(`${wsProtocol}://${location.host}`, `docs/${room}`, ydoc);
  currentProvider = provider;

  provider.awareness.setLocalStateField('user', { name: userName, color: userColor, colorLight: userColor + '33' });

  provider.awareness.on('change', () => {
    const count = provider.awareness.getStates().size;
    peersEl.textContent = `${count} persona${count === 1 ? '' : 's'} conectada${count === 1 ? '' : 's'} en "${room}"`;
  });

  const ytext = ydoc.getText('codemirror');

  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      basicSetup,
      javascript(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      history(),
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
