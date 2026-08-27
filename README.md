# Editor colaborativo en tiempo real

Editor de código C++ tipo VS Code donde varias personas editan a la vez y ven los cambios de las demás al instante (cursores incluidos, multi-archivo con explorador lateral), como Google Docs pero para código — con un botón para compilar y correr el programa en una terminal interactiva real (tipo OnlineGDB) y una clave de acceso opcional.

## Cómo funciona

- **Yjs**: estructura de datos CRDT que sincroniza cada archivo entre todos los clientes sin conflictos, aunque escriban al mismo tiempo. Cada sala tiene su propio workspace: una lista de archivos (`Y.Array`) + un texto colaborativo por archivo (`Y.Text`).
- **y-websocket** + **y-leveldb**: servidor y proveedor de WebSocket que retransmite los cambios de Yjs entre clientes conectados a la misma sala, y los persiste en disco (`data/yjs/`) para que sobrevivan a que el contenedor se duerma o reinicie sin redeploy.
- **CodeMirror 6** + **y-codemirror.next**: editor de código en el navegador, con resaltado de sintaxis (tema VS Code Dark+) y cursores remotos coloreados por usuario (solo se ven cuando dos personas están en el mismo archivo).
- **node-pty** + **xterm.js**: al apretar "▶ Ejecutar" (o Ctrl/Cmd+Enter), el servidor compila el archivo activo con `g++ -std=c++20` en un directorio temporal aislado y corre el binario en una pseudo-terminal real, streameada por WebSocket a una terminal xterm.js en el navegador. Como es una pty de verdad, `cin`/`getline` bloquean esperando texto igual que en una terminal normal.

El cliente se compila con **esbuild** a un solo bundle (`public/bundle.js`), sin depender de CDNs sueltos en producción.

## Uso

```bash
npm install
npm start
```

Abrí `http://localhost:3000` en varias pestañas o desde otras computadoras (usando la IP del server). Todos los que entren a la misma "sala" (campo de texto arriba a la izquierda, o `?room=nombre` en la URL) editan el mismo workspace en tiempo real: creá, renombrá o borrá archivos desde el explorador de la izquierda, cambiá entre ellos con un click.

Para compartir con otra persona en otra red, hay que exponer el puerto 3000 (por ejemplo con un túnel como `ngrok http 3000`) o desplegar el server en algún hosting.

## Deploy

Este repo trae un `Dockerfile` y un `render.yaml` para desplegar en [Render](https://render.com) con un click (Blueprint). El servicio corre en Docker porque necesita `g++` instalado, algo que el runtime Node nativo de Render no trae.

## Clave de acceso

Configurando la variable de entorno `APP_PASSWORD` (Render: **Environment** → **Add Environment Variable**), el editor pide una clave compartida antes de dejar entrar a nadie — sin ella, cualquiera con el link puede editar. Es una única contraseña para todos los que quieras que editen, no cuentas individuales.

El navegador guarda un token de sesión (30 días) en `localStorage` después de loguearse una vez, así que no hay que escribir la clave en cada visita. Sin `APP_PASSWORD` configurada, el editor queda abierto como antes (sin pantalla de login).

## Guardar el workspace en GitHub

El botón **💾 Guardar** commitea *todos* los archivos de la sala actual a este mismo repo (`saves/<sala>/<archivo>`, en una branch separada — `code-saves` por defecto — para no ensuciar el historial de desarrollo), en un único commit. Al entrar a una sala vacía, si hay una versión guardada la carga automáticamente en vez del ejemplo por defecto.

Es opcional y se degrada bien: sin configurar nada, el botón queda visible pero avisa que no está habilitado. Variables necesarias (mismo lugar que `APP_PASSWORD`, nunca las pongas en `render.yaml` ni las commitees):

| Variable | Valor |
|---|---|
| `GITHUB_TOKEN` | Un [Personal Access Token](https://github.com/settings/tokens) (fine-grained, con permiso *Contents: Read and write* sobre este repo) |
| `GITHUB_REPO` | `sant1jmnz/Laboratorio` |
| `GITHUB_SAVE_BRANCH` | *(opcional)* nombre de la branch donde guardar. Por defecto `code-saves`, se crea sola si no existe. |

Nota: la persistencia en disco (y-leveldb) ya evita que se pierda algo por dejar un archivo "sin guardar" dentro de una misma sesión del contenedor — el botón "Guardar" es la copia de seguridad que sobrevive incluso a un redeploy nuevo (el disco del free tier de Render es efímero entre deploys).

## Estructura

- `server/index.js`: servidor Express + WebSocket. Rutea `/run-ws` a la terminal interactiva y todo lo demás (`/docs/<sala>`) a la sincronización Yjs; gatea ambos con la clave de acceso si está configurada.
- `server/auth.js`: clave compartida + tokens de sesión firmados (HMAC), sin base de datos de usuarios.
- `server/run-cpp.js`: compila el código C++ en un directorio temporal aislado (sin usar shell).
- `server/interactive-run.js`: maneja las sesiones interactivas por WebSocket (spawn de la pty, límites de concurrencia, timeouts de inactividad y duración máxima, listado/descarga de archivos generados).
- `server/github-save.js`: guarda/carga el workspace completo de cada sala en este repo vía la Git Data API de GitHub (blobs + tree + commit, en un solo commit atómico).
- `client/main.js`: lógica del editor (CodeMirror + Yjs + terminal xterm.js + explorador de archivos + login), compilada a `public/bundle.js` con `npm run build`.
- `public/index.html`: estructura y estilos de la página.
