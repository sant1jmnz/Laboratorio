import crypto from 'node:crypto';
import { query } from './db.js';

const MAX_NAME = 80;

/**
 * ID publico del proyecto: corto, sin ambiguedades visuales (sin 0/O, 1/l/I)
 * para que se pueda dictar por telefono, y con entropia suficiente para que
 * no se pueda adivinar el proyecto de otro (32^12 ~ 10^18 combinaciones).
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newProjectId(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function cleanName(name) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Proyecto sin nombre';
  return trimmed.slice(0, MAX_NAME);
}

export async function createProject(ownerId, name) {
  const id = newProjectId();
  await query('INSERT INTO projects (id, owner_id, name) VALUES ($1, $2, $3)', [
    id,
    ownerId,
    cleanName(name),
  ]);
  return getProject(id);
}

export async function getProject(id) {
  if (typeof id !== 'string' || !id) return null;
  const { rows } = await query(
    `SELECT p.id, p.owner_id, p.name, p.created_at, p.updated_at, u.username AS owner_name
       FROM projects p JOIN users u ON u.id = p.owner_id
      WHERE p.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/** Proyectos propios y, aparte, los que abrio por link y son de otros. */
export async function listProjects(userId) {
  const own = await query(
    `SELECT id, name, created_at, updated_at
       FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 200`,
    [userId]
  );
  const shared = await query(
    `SELECT p.id, p.name, p.updated_at, u.username AS owner_name, v.last_seen
       FROM project_visits v
       JOIN projects p ON p.id = v.project_id
       JOIN users u ON u.id = p.owner_id
      WHERE v.user_id = $1 AND p.owner_id <> $1
      ORDER BY v.last_seen DESC LIMIT 100`,
    [userId]
  );
  return { own: own.rows, shared: shared.rows };
}

export async function renameProject(id, ownerId, name) {
  const { rowCount } = await query(
    'UPDATE projects SET name = $3, updated_at = now() WHERE id = $1 AND owner_id = $2',
    [id, ownerId, cleanName(name)]
  );
  return rowCount > 0;
}

export async function deleteProject(id, ownerId) {
  const { rowCount } = await query('DELETE FROM projects WHERE id = $1 AND owner_id = $2', [
    id,
    ownerId,
  ]);
  return rowCount > 0;
}

/** Deja registrado que este usuario abrio un proyecto ajeno. */
export async function recordVisit(userId, projectId) {
  await query(
    `INSERT INTO project_visits (user_id, project_id, last_seen) VALUES ($1, $2, now())
     ON CONFLICT (user_id, project_id) DO UPDATE SET last_seen = now()`,
    [userId, projectId]
  ).catch(() => {});
}

export async function touchProject(projectId) {
  await query('UPDATE projects SET updated_at = now() WHERE id = $1', [projectId]).catch(() => {});
}

// ---- Estado del documento colaborativo ----

export async function loadDocState(projectId) {
  const { rows } = await query('SELECT state FROM project_docs WHERE project_id = $1', [projectId]);
  return rows[0]?.state ?? null;
}

export async function saveDocState(projectId, state) {
  await query(
    `INSERT INTO project_docs (project_id, state, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (project_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [projectId, state]
  );
}
