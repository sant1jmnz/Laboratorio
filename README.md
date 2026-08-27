# Editor colaborativo en tiempo real

Editor de código C++ donde varias personas pueden escribir a la vez y ver los cambios de las demás al instante (cursores incluidos), como Google Docs pero para código — y con un botón para compilar y correr el programa en una terminal interactiva real, tipo OnlineGDB.

## Cómo funciona

- **Yjs**: estructura de datos CRDT que sincroniza el texto entre todos los clientes sin conflictos, aunque escriban al mismo tiempo.
- **y-websocket**: servidor y proveedor de WebSocket que retransmite los cambios de Yjs entre clientes conectados a la misma "sala".
- **CodeMirror 6** + **y-codemirror.next**: editor de código en el navegador, con resaltado de sintaxis (tema VS Code Dark+) y cursores remotos coloreados por usuario.
- **node-pty** + **xterm.js**: al apretar "▶ Ejecutar" (o Ctrl/Cmd+Enter), el servidor compila el código con `g++ -std=c++20` en un directorio temporal aislado y corre el binario en una pseudo-terminal real, streameada por WebSocket a una terminal xterm.js en el navegador. Como es una pty de verdad, `cin`/`getline` bloquean esperando texto igual que en una terminal normal (no hay que precargar el stdin de antemano).

El cliente se compila con **esbuild** a un solo bundle (`public/bundle.js`), sin depender de CDNs sueltos en producción.

## Uso

```bash
npm install
npm start
```

Abrí `http://localhost:3000` en varias pestañas o desde otras computadoras (usando la IP del server). Todos los que entren a la misma "sala" (campo de texto arriba a la izquierda, o `?room=nombre` en la URL) editan el mismo documento en tiempo real.

Para compartir con otra persona en otra red, hay que exponer el puerto 3000 (por ejemplo con un túnel como `ngrok http 3000`) o desplegar el server en algún hosting.

## Deploy

Este repo trae un `Dockerfile` y un `render.yaml` para desplegar en [Render](https://render.com) con un click (Blueprint). El servicio corre en Docker porque necesita `g++` instalado, algo que el runtime Node nativo de Render no trae.

## Guardar el código en GitHub

El botón **💾 Guardar** commitea el código de la sala actual a este mismo repo (como `saves/<sala>.cpp`, en una branch separada — `code-saves` por defecto — para no ensuciar el historial de desarrollo). Al volver a entrar a una sala, si hay una versión guardada la carga automáticamente en vez del código de ejemplo.

Es opcional: sin configurar nada, el botón queda visible pero avisa que no está habilitado. Para activarlo hay que cargar estas variables de entorno en el servicio (en Render: **Environment** → **Add Environment Variable** — nunca las pongas en `render.yaml` ni las commitees):

| Variable | Valor |
|---|---|
| `GITHUB_TOKEN` | Un [Personal Access Token](https://github.com/settings/tokens) (fine-grained, con permiso *Contents: Read and write* sobre este repo) |
| `GITHUB_REPO` | `sant1jmnz/Laboratorio` |
| `GITHUB_SAVE_BRANCH` | *(opcional)* nombre de la branch donde guardar. Por defecto `code-saves`, se crea sola si no existe. |

## Estructura

- `server/index.js`: servidor Express + WebSocket. Rutea `/run-ws` a la terminal interactiva y todo lo demás (`/docs/<sala>`) a la sincronización Yjs.
- `server/run-cpp.js`: compila el código C++ en un directorio temporal aislado (sin usar shell).
- `server/interactive-run.js`: maneja las sesiones interactivas por WebSocket (spawn de la pty, límites de concurrencia, timeouts de inactividad y duración máxima).
- `server/github-save.js`: guarda/carga el código de cada sala como archivo en este repo vía la API de GitHub.
- `client/main.js`: lógica del editor (CodeMirror + Yjs + terminal xterm.js), compilada a `public/bundle.js` con `npm run build`.
- `public/index.html`: estructura y estilos de la página.
