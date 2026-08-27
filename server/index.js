import express from 'express';
import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';
import { handleInteractiveConnection } from './interactive-run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

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
