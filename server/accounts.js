import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';

const scrypt = promisify(crypto.scrypt);

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;

function sessionKey() {
  // Si no hay secreto propio, derivamos uno de la URL de la base: asi las
  // sesiones siguen siendo validas entre reinicios sin exigir configuracion
  // extra, pero nunca usamos un valor por defecto publico.
  const secret = process.env.SESSION_SECRET || process.env.DATABASE_URL;
  if (!secret) return null;
  return crypto.createHash('sha256').update(`sesion:${secret}`).digest();
}

export function newId(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, derived);
}

function sign(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

export function issueSession(userId) {
  const key = sessionKey();
  if (!key) return null;
  const payload = `${userId}.${Date.now() + SESSION_TTL_MS}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload, key)}`;
}

/** Devuelve el userId si el token es valido y no expiro, o null. */
export function readSession(token) {
  const key = sessionKey();
  if (!key || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;

  const payload = Buffer.from(token.slice(0, dot), 'base64url').toString();
  const expected = sign(payload, key);
  const given = token.slice(dot + 1);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const sep = payload.lastIndexOf('.');
  const userId = payload.slice(0, sep);
  const expires = Number(payload.slice(sep + 1));
  if (!userId || !Number.isFinite(expires) || expires < Date.now()) return null;
  return userId;
}

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'El usuario debe tener entre 3 y 24 caracteres (letras, numeros, . _ -).';
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  }
  if (password.length > MAX_PASSWORD) return 'La contraseña es demasiado larga.';
  return null;
}

export async function registerUser(username, password) {
  const problem = validateCredentials(username, password);
  if (problem) return { ok: false, message: problem };

  const id = newId();
  const hash = await hashPassword(password);
  try {
    await query(
      'INSERT INTO users (id, username, username_low, password_hash) VALUES ($1, $2, $3, $4)',
      [id, username, username.toLowerCase(), hash]
    );
  } catch (err) {
    if (err.code === '23505') return { ok: false, message: 'Ese usuario ya existe.' };
    throw err;
  }
  return { ok: true, user: { id, username } };
}

export async function loginUser(username, password) {
  const genericError = { ok: false, message: 'Usuario o contraseña incorrectos.' };
  if (typeof username !== 'string' || typeof password !== 'string') return genericError;

  const { rows } = await query(
    'SELECT id, username, password_hash FROM users WHERE username_low = $1',
    [username.toLowerCase()]
  );
  if (rows.length === 0) {
    // Gastamos el mismo tiempo que en un login real para no filtrar por
    // temporizacion si el usuario existe o no.
    await hashPassword(password);
    return genericError;
  }

  const row = rows[0];
  const okPassword = await verifyPassword(password, row.password_hash).catch(() => false);
  if (!okPassword) return genericError;
  return { ok: true, user: { id: row.id, username: row.username } };
}

export async function getUser(userId) {
  const { rows } = await query('SELECT id, username FROM users WHERE id = $1', [userId]);
  return rows[0] ?? null;
}
