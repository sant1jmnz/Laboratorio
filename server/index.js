import express from 'express';
import http from 'http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import { handleInteractiveConnection } from './interactive-run.js';
import { isConfigured, loadWorkspace, saveWorkspace } from './github-save.js';
import { authRequired, checkPassword, issueToken, verifyToken } from './auth.js';
import { languageSummaries } from './languages.js';

// y-websocket/bin/utils (CJS) carga yjs via require(), que resuelve a un
// build distinto (dist/yjs.cjs) del que usa `import 'yjs'` (dist/yjs.mjs).
// Dos instancias de la misma libreria rompen los chequeos internos de Yjs
// (instanceof, etc). Requerimos yjs y y-leveldb con require() aca tambien
// (en vez de `import`), para que ambos compartan exactamente la misma
// instancia de yjs que ya usa y-websocket internamente.
const require = createRequire(import.meta.url);
const Y = require('yjs');
const { LeveldbPersistence } = require('y-leveldb');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Persiste los documentos Yjs (workspaces de cada sala) en disco, asi
// sobreviven a que el contenedor se duerma/despierte o a un reinicio sin
// redeploy. No sobrevive a un redeploy real en el free tier de Render
// (disco efimero) -- para eso esta el boton "Guardar" a GitHub.
const persistenceDir = process.env.YPERSISTENCE || path.join(__dirname, '..', 'data', 'yjs');
const ldb = new LeveldbPersistence(persistenceDir);
setPersistence({
  bindState: async (docName, ydoc) => {
    const persisted = await ldb.getYDoc(docName);
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persisted));
    ydoc.on('update', (update) => {
      ldb.storeUpdate(docName, update);
    });
  },
  writeState: async () => {},
});

const app = express();
app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function requireAuth(req, res, next) {
  if (!authRequired()) return next();
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (verifyToken(token)) return next();
  res.status(401).json({ ok: false, message: 'No autenticado.' });
}

app.get('/api/auth-status', (_req, res) => {
  res.json({ required: authRequired() });
});

app.get('/api/languages', (_req, res) => {
  res.json({ languages: languageSummaries() });
});

app.post('/api/login', (req, res) => {
  const { password } = req.body ?? {};
  if (!checkPassword(password)) {
    res.status(401).json({ ok: false, message: 'Clave incorrecta.' });
    return;
  }
  res.json({ ok: true, token: issueToken() });
});

app.get('/api/save-status', requireAuth, (_req, res) => {
  res.json({ enabled: isConfigured() });
});

app.get('/api/saved/:room', requireAuth, async (req, res) => {
  try {
    const files = await loadWorkspace(req.params.room);
    res.json({ files });
  } catch {
    res.status(500).json({ files: [] });
  }
});

app.post('/api/save', requireAuth, async (req, res) => {
  const { room, files, author } = req.body ?? {};
  if (typeof room !== 'string' || !Array.isArray(files)) {
    res.status(400).json({ ok: false, message: 'Falta room o files.' });
    return;
  }
  const result = await saveWorkspace(room, files, author);
  res.status(result.ok ? 200 : 500).json(result);
});

const server = http.createServer(app);

// Dos WebSocketServer separados, ruteados a mano por path en "upgrade":
// /run-ws es la terminal interactiva de compilar/ejecutar; todo lo demas
// (/docs/<sala>) es la sincronizacion colaborativa de Yjs.
const collabWss = new WebSocketServer({ noServer: true });
const runWss = new WebSocketServer({ noServer: true });

collabWss.on('connection', (ws, req) => {
  setupWSConnection(ws, req);
});

runWss.on('connection', (ws) => {
  handleInteractiveConnection(ws);
});

server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  if (authRequired() && !verifyToken(searchParams.get('token'))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const wss = pathname === '/run-ws' ? runWss : collabWss;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`Editor colaborativo escuchando en http://localhost:${PORT}`);
});
