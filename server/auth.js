import crypto from 'node:crypto';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function secretKey() {
  const password = process.env.APP_PASSWORD;
  if (!password) return null;
  return crypto.createHash('sha256').update(password).digest();
}

export function authRequired() {
  return Boolean(process.env.APP_PASSWORD);
}

function sign(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

/** Devuelve un token opaco valido por TOKEN_TTL_MS, o null si no hay clave configurada. */
export function issueToken() {
  const key = secretKey();
  if (!key) return null;
  const expires = Date.now() + TOKEN_TTL_MS;
  const payload = String(expires);
  return `${payload}.${sign(payload, key)}`;
}

export function checkPassword(password) {
  const configured = process.env.APP_PASSWORD;
  if (!configured) return true;
  if (typeof password !== 'string') return false;
  const a = Buffer.from(password);
  const b = Buffer.from(configured);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** true si no hay clave configurada (app abierta) o el token es valido y no expiro. */
export function verifyToken(token) {
  const key = secretKey();
  if (!key) return true;
  if (typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}
