import express from 'express';
import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // El nombre de la "room" (documento) viaja en el path: /docs/<nombre>
  setupWSConnection(ws, req);
});

server.listen(PORT, () => {
  console.log(`Editor colaborativo escuchando en http://localhost:${PORT}`);
});
