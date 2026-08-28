import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function dbEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!dbEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Los Postgres gestionados (Neon, Supabase, Render) exigen TLS, pero
      // presentan certificados de una CA que Node no trae por defecto.
      ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
    });
    pool.on('error', (err) => {
      console.error('Error inesperado en el pool de Postgres:', err.message);
    });
  }
  return pool;
}

export function query(text, params) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL no esta configurada.');
  return p.query(text, params);
}

/** Crea las tablas si no existen. Se llama una vez al arrancar. */
export async function initSchema() {
  if (!dbEnabled()) return false;

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL,
      username_low  TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner_id, updated_at DESC);`);

  // Estado del documento colaborativo (Yjs) serializado. Va en la base y no
  // en disco para que sobreviva a los redeploys, donde el disco se borra.
  await query(`
    CREATE TABLE IF NOT EXISTS project_docs (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      state      BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Proyectos que alguien abrio por link y no son suyos, para que le
  // aparezcan en "Compartidos conmigo".
  await query(`
    CREATE TABLE IF NOT EXISTS project_visits (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, project_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS visits_user_idx ON project_visits (user_id, last_seen DESC);`);

  return true;
}

export async function closePool() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}
