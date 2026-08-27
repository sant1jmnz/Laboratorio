import express from 'express';
import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';
import { handleInteractiveConnection } from './interactive-run.js';
import { isConfigured, loadSavedCode, saveCode } from './github-save.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/save-status', (_req, res) => {
  res.json({ enabled: isConfigured() });
});

app.get('/api/saved/:room', async (req, res) => {
  try {
    const code = await loadSavedCode(req.params.room);
    res.json({ code });
  } catch {
    res.status(500).json({ code: null });
  }
});

app.post('/api/save', async (req, res) => {
  const { room, code, author } = req.body ?? {};
  if (typeof room !== 'string' || typeof code !== 'string') {
    res.status(400).json({ ok: false, message: 'Falta room o code.' });
    return;
  }
  const result = await saveCode(room, code, author);
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
  const { pathname } = new URL(req.url, 'http://localhost');
  const wss = pathname === '/run-ws' ? runWss : collabWss;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`Editor colaborativo escuchando en http://localhost:${PORT}`);
});
