import express from 'express';
import http from 'http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import { handleInteractiveConnection } from './interactive-run.js';
import { handleDebugConnection } from './debug-session.js';
import { isConfigured, loadWorkspace, saveWorkspace } from './github-save.js';
import { languageSummaries } from './languages.js';
import { dbEnabled, initSchema } from './db.js';
import { getUser, issueSession, loginUser, readSession, registerUser } from './accounts.js';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  loadDocState,
  recordVisit,
  renameProject,
  saveDocState,
  touchProject,
} from './projects.js';

// y-websocket/bin/utils (CJS) carga yjs via require(), que resuelve a un
// build distinto (dist/yjs.cjs) del que usa `import 'yjs'` (dist/yjs.mjs).
// Dos instancias de la misma libreria rompen los chequeos internos de Yjs
// (instanceof, etc), asi que lo requerimos igual que y-websocket para que
// ambos compartan exactamente la misma instancia.
const require = createRequire(import.meta.url);
const Y = require('yjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------
// Persistencia del contenido de los proyectos
//
// El estado Yjs va a Postgres (no a disco) porque el disco del plan free
// se borra en cada redeploy. Se guarda con debounce: mientras alguien
// escribe no tocamos la base, y volcamos el documento entero un rato
// despues de la ultima tecla.
// ---------------------------------------------------------------------
const SAVE_DEBOUNCE_MS = 1500;
const pendingSaves = new Map(); // docName -> timeout

function projectIdFromDocName(docName) {
  // El cliente se conecta a /docs/<projectId>
  return String(docName).replace(/^docs\//, '');
}

if (dbEnabled()) {
  setPersistence({
    bindState: async (docName, ydoc) => {
      const projectId = projectIdFromDocName(docName);
      const saved = await loadDocState(projectId).catch(() => null);
      if (saved && saved.length > 0) {
        Y.applyUpdate(ydoc, new Uint8Array(saved));
      }

      ydoc.on('update', () => {
        if (pendingSaves.has(docName)) return;
        pendingSaves.set(
          docName,
          setTimeout(async () => {
            pendingSaves.delete(docName);
            try {
              await saveDocState(projectId, Buffer.from(Y.encodeStateAsUpdate(ydoc)));
              await touchProject(projectId);
            } catch (err) {
              console.error(`No se pudo guardar el proyecto ${projectId}:`, err.message);
            }
          }, SAVE_DEBOUNCE_MS)
        );
      });
    },
    writeState: async (docName, ydoc) => {
      // Se llama cuando se va el ultimo cliente: guardamos ya, sin esperar.
      const projectId = projectIdFromDocName(docName);
      clearTimeout(pendingSaves.get(docName));
      pendingSaves.delete(docName);
      await saveDocState(projectId, Buffer.from(Y.encodeStateAsUpdate(ydoc))).catch((err) => {
        console.error(`No se pudo guardar el proyecto ${projectId}:`, err.message);
      });
    },
  });
}

const app = express();
app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function tokenFromRequest(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Corta con 401 si no hay sesion valida; si la hay, deja req.userId. */
function requireAuth(req, res, next) {
  const userId = readSession(tokenFromRequest(req));
  if (!userId) {
    res.status(401).json({ ok: false, message: 'Necesitas iniciar sesion.' });
    return;
  }
  req.userId = userId;
  next();
}

function needsDb(_req, res, next) {
  if (!dbEnabled()) {
    res.status(503).json({ ok: false, message: 'El servidor no tiene base de datos configurada.' });
    return;
  }
  next();
}

app.get('/api/config', (_req, res) => {
  res.json({ accounts: dbEnabled(), languages: languageSummaries() });
});

// ---- Cuentas ----

app.post('/api/register', needsDb, async (req, res) => {
  const { username, password } = req.body ?? {};
  try {
    const result = await registerUser(username, password);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({ ok: true, token: issueSession(result.user.id), user: result.user });
  } catch (err) {
    console.error('Error registrando usuario:', err.message);
    res.status(500).json({ ok: false, message: 'No se pudo crear la cuenta.' });
  }
});

app.post('/api/login', needsDb, async (req, res) => {
  const { username, password } = req.body ?? {};
  try {
    const result = await loginUser(username, password);
    if (!result.ok) {
      res.status(401).json(result);
      return;
    }
    res.json({ ok: true, token: issueSession(result.user.id), user: result.user });
  } catch (err) {
    console.error('Error iniciando sesion:', err.message);
    res.status(500).json({ ok: false, message: 'No se pudo iniciar sesion.' });
  }
});

app.get('/api/me', needsDb, requireAuth, async (req, res) => {
  const user = await getUser(req.userId);
  if (!user) {
    res.status(401).json({ ok: false, message: 'Sesion invalida.' });
    return;
  }
  res.json({ ok: true, user });
});

// ---- Proyectos ----

app.get('/api/projects', needsDb, requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, ...(await listProjects(req.userId)) });
  } catch (err) {
    console.error('Error listando proyectos:', err.message);
    res.status(500).json({ ok: false, message: 'No se pudieron cargar los proyectos.' });
  }
});

app.post('/api/projects', needsDb, requireAuth, async (req, res) => {
  try {
    const project = await createProject(req.userId, req.body?.name);
    res.json({ ok: true, project });
  } catch (err) {
    console.error('Error creando proyecto:', err.message);
    res.status(500).json({ ok: false, message: 'No se pudo crear el proyecto.' });
  }
});

app.get('/api/projects/:id', needsDb, requireAuth, async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ ok: false, message: 'Ese proyecto no existe.' });
    return;
  }
  // Cualquiera con el link puede abrirlo; si no es suyo, queda registrado
  // en "Compartidos conmigo".
  if (project.owner_id !== req.userId) await recordVisit(req.userId, project.id);
  res.json({
    ok: true,
    project: {
      id: project.id,
      name: project.name,
      ownerName: project.owner_name,
      isOwner: project.owner_id === req.userId,
    },
  });
});

app.patch('/api/projects/:id', needsDb, requireAuth, async (req, res) => {
  const ok = await renameProject(req.params.id, req.userId, req.body?.name);
  if (!ok) {
    res.status(403).json({ ok: false, message: 'Solo el dueño puede renombrar el proyecto.' });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/projects/:id', needsDb, requireAuth, async (req, res) => {
  const ok = await deleteProject(req.params.id, req.userId);
  if (!ok) {
    res.status(403).json({ ok: false, message: 'Solo el dueño puede borrar el proyecto.' });
    return;
  }
  res.json({ ok: true });
});

// ---- Guardado en GitHub (opcional) ----

app.get('/api/save-status', requireAuth, (_req, res) => {
  res.json({ enabled: isConfigured() });
});

app.get('/api/saved/:room', requireAuth, async (req, res) => {
  try {
    res.json({ files: await loadWorkspace(req.params.room) });
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

// La app es de una sola pagina: /p/<id> lo resuelve el cliente.
app.get('/p/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = http.createServer(app);

// Tres WebSocketServer ruteados a mano por path en "upgrade":
// /run-ws es la terminal interactiva, /debug-ws el depurador, y el resto
// (/docs/<proyecto>) la sincronizacion colaborativa de Yjs.
const collabWss = new WebSocketServer({ noServer: true });
const runWss = new WebSocketServer({ noServer: true });
const debugWss = new WebSocketServer({ noServer: true });

collabWss.on('connection', (ws, req) => {
  setupWSConnection(ws, req);
});
runWss.on('connection', (ws) => {
  handleInteractiveConnection(ws);
});
debugWss.on('connection', (ws) => {
  handleDebugConnection(ws);
});

server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  // Con cuentas activas, ninguna conexion (ni colaboracion ni ejecucion)
  // se acepta sin sesion valida.
  if (dbEnabled() && !readSession(searchParams.get('token'))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const wss =
    pathname === '/run-ws' ? runWss : pathname === '/debug-ws' ? debugWss : collabWss;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

/**
 * Prepara la base reintentando con espera creciente.
 *
 * Los Postgres gestionados gratuitos (Supabase, Neon) pausan el proyecto
 * tras dias de inactividad y la primera conexion falla mientras despierta.
 * Sin reintentos, ese hipo hace fallar el deploy entero y hay que
 * redesplegar a mano.
 */
async function connectWithRetry(attempts = 6) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await initSchema();
      console.log('Base de datos lista.');
      return true;
    } catch (err) {
      const last = i === attempts;
      const waitMs = Math.min(1000 * 2 ** (i - 1), 15_000);
      console.error(
        `No se pudo conectar a la base (intento ${i}/${attempts}): ${err.message}` +
          (last ? '' : ` — reintento en ${Math.round(waitMs / 1000)}s`)
      );
      if (last) return false;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return false;
}

async function start() {
  if (dbEnabled()) {
    const ready = await connectWithRetry();
    if (!ready) {
      console.error(
        'La base sigue sin responder. Revisá DATABASE_URL: en Supabase tiene que ser la cadena ' +
          'del "Session pooler" (no la "Direct connection", que es solo IPv6), y los caracteres ' +
          'especiales de la contraseña van codificados (/ es %2F, @ es %40).'
      );
      process.exit(1);
    }
  } else {
    console.warn(
      'DATABASE_URL no esta configurada: el editor arranca sin cuentas ni proyectos guardados.'
    );
  }

  server.listen(PORT, () => {
    console.log(`Editor colaborativo escuchando en http://localhost:${PORT}`);
  });
}

start();
