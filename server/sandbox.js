import { chmod, chown } from 'node:fs/promises';

/**
 * Aislamiento del codigo de los usuarios.
 *
 * El servidor corre como root dentro del contenedor, pero los programas que
 * escriben los usuarios NO deben correr con ese privilegio: cualquiera podria
 * leer /proc/<pid del servidor>/environ y llevarse el GITHUB_TOKEN o la
 * APP_PASSWORD, o tocar los archivos del propio servidor.
 *
 * Por eso los ejecutamos como un usuario sin privilegios (RUNNER_UID/GID).
 * /proc/<pid>/environ solo lo puede leer el dueño del proceso, asi que con
 * esto el codigo del usuario deja de ver los secretos del servidor.
 *
 * Si las variables no estan definidas (desarrollo local), no se cambia de
 * usuario y todo sigue funcionando como antes.
 */
function parseId(value) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const RUNNER_UID = parseId(process.env.RUNNER_UID);
const RUNNER_GID = parseId(process.env.RUNNER_GID);

export const sandboxEnabled = RUNNER_UID !== null && RUNNER_GID !== null;

/** Opciones de uid/gid para pasarle a spawn/pty.spawn. */
export function runnerSpawnOptions() {
  return sandboxEnabled ? { uid: RUNNER_UID, gid: RUNNER_GID } : {};
}

/**
 * Deja el directorio de trabajo en manos del usuario sin privilegios, para
 * que el programa pueda crear ahi sus archivos (los .dat de fstream, etc).
 */
export async function handOverDir(dir) {
  if (!sandboxEnabled) return;
  await chown(dir, RUNNER_UID, RUNNER_GID).catch(() => {});
  await chmod(dir, 0o700).catch(() => {});
}

/** El binario compilado lo produce root; hay que dejarlo ejecutable. */
export async function makeExecutable(binaryPath) {
  if (!sandboxEnabled) return;
  await chown(binaryPath, RUNNER_UID, RUNNER_GID).catch(() => {});
  await chmod(binaryPath, 0o755).catch(() => {});
}

/**
 * Cede la terminal (/dev/pts/N) al usuario sin privilegios.
 *
 * Aunque el proceso de la pty corra como runner, el dispositivo queda a
 * nombre de root con permisos 600. Cuando el programa hereda la pty ya
 * conectada (modo Ejecutar) da igual, pero GDB la ABRE POR NOMBRE con
 * -inferior-tty-set, y sin este chown no puede y el programa nunca arranca.
 */
export async function handOverTty(ttyPath) {
  if (!sandboxEnabled || !ttyPath) return;
  await chown(ttyPath, RUNNER_UID, RUNNER_GID).catch(() => {});
  await chmod(ttyPath, 0o620).catch(() => {});
}
