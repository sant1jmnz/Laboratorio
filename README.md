# Editor colaborativo en tiempo real

Editor de código multi-lenguaje tipo VS Code donde varias personas editan a la vez y ven los cambios de las demás al instante (cursores incluidos, multi-archivo con explorador lateral), como Google Docs pero para código — con un botón para compilar y correr el programa en una terminal interactiva real (tipo OnlineGDB) y una clave de acceso opcional.

## Lenguajes soportados

| Lenguaje | Extensiones | Cómo corre |
|---|---|---|
| C++ | `.cpp` `.cc` `.cxx` | `g++ -std=c++20` · **con debugger** |
| C | `.c` | `gcc -std=c17` · **con debugger** |
| Python | `.py` | `python3 -u` |
| JavaScript | `.js` `.mjs` | `node` |
| Java | `.java` | `javac` + `java` |

El lenguaje se detecta por la extensión del archivo activo: creás `script.py` en el explorador y "Ejecutar" ya lo corre con Python, sin configurar nada. El resaltado de sintaxis y el indicador de la barra de estado se ajustan solos.

## Depurador

El botón **Depurar** (o `F5`) corre el programa bajo **GDB** de verdad, no una simulación:

- **Breakpoints**: click en la canaleta a la izquierda de los números de línea, como en VS Code. Se pueden poner y sacar incluso con la sesión ya corriendo.
- **Variables locales** y **pila de llamadas** en el panel de la izquierda, actualizadas en cada pausa.
- **Controles**: Continuar (`F8`), Siguiente/step over (`F10`), Entrar/step into (`F11`), Salir/step out (`Shift+F11`).
- **La terminal sigue siendo interactiva mientras depurás**: el programa corre en su propia pty, separada del canal por el que el servidor habla con GDB, así que `cin`/`scanf` funcionan normal aunque estés pausado en un breakpoint.

Por ahora solo aplica a C y C++ (GDB); con un archivo Python/JS/Java el botón se deshabilita y explica por qué, pero **Ejecutar** sigue funcionando igual.

## Cómo funciona

- **Yjs**: estructura de datos CRDT que sincroniza cada archivo entre todos los clientes sin conflictos, aunque escriban al mismo tiempo. Cada proyecto tiene su propio workspace: una lista de archivos (`Y.Array`) + un texto colaborativo por archivo (`Y.Text`).
- **y-websocket** + **Postgres**: servidor y proveedor de WebSocket que retransmite los cambios de Yjs entre clientes conectados al mismo proyecto, y los guarda en la base (con debounce mientras escribís, y de inmediato cuando se va el último cliente) para que sobrevivan a cualquier reinicio o redeploy.
- **CodeMirror 6** + **y-codemirror.next**: editor de código en el navegador, con resaltado de sintaxis (tema VS Code Dark+) y cursores remotos coloreados por usuario (solo se ven cuando dos personas están en el mismo archivo).
- **node-pty** + **xterm.js**: al apretar "▶ Ejecutar" (o Ctrl/Cmd+Enter), el servidor compila el archivo activo con `g++ -std=c++20` en un directorio temporal aislado y corre el binario en una pseudo-terminal real, streameada por WebSocket a una terminal xterm.js en el navegador. Como es una pty de verdad, `cin`/`getline` bloquean esperando texto igual que en una terminal normal.

El cliente se compila con **esbuild** a un solo bundle (`public/bundle.js`), sin depender de CDNs sueltos en producción.

## Uso

```bash
npm install
npm start
```

Abrí `http://localhost:3000`, creá tu cuenta y ya tenés tu panel de proyectos. Cada proyecto tiene un **ID único** y vive en su propio link (`/p/<id>`): el botón **Compartir** lo copia, y quien lo abra entra a editar en vivo con vos.

Dentro de un proyecto: creá, renombrá o borrá archivos desde el explorador de la izquierda y cambiá entre ellos con un click.

Para compartir con otra persona en otra red, hay que exponer el puerto 3000 (por ejemplo con un túnel como `ngrok http 3000`) o desplegar el server en algún hosting.

## Deploy

Este repo trae un `Dockerfile` y un `render.yaml` para desplegar en [Render](https://render.com) con un click (Blueprint). El servicio corre en Docker porque necesita `g++` instalado, algo que el runtime Node nativo de Render no trae.

## Aislamiento del código que se ejecuta

El servidor corre como root dentro del contenedor, pero **los programas de los usuarios nunca**: se ejecutan como un usuario del sistema sin privilegios (`runner`, uid/gid 999, configurable con `RUNNER_UID`/`RUNNER_GID`).

Esto no es opcional si vas a publicar el editor. Sin eso, cualquiera que pueda ejecutar código podría leer `/proc/<pid del servidor>/environ` y llevarse el `GITHUB_TOKEN` y la `APP_PASSWORD` — lo verifiqué, funcionaba. Con el cambio, ese mismo programa recibe permiso denegado.

Además: a los programas se les pasa un entorno acotado a mano (`PATH`, `HOME`, `LANG`), nunca el del servidor, y el código del servidor queda ilegible para `runner` (`chmod go-rwx /app`).

Lo que un programa **sí** puede hacer todavía: usar la red y consumir CPU/memoria hasta los límites de tiempo y concurrencia que aplica el servidor. Para un uso entre gente conocida está bien; para abrirlo a internet sin clave, convendría además un contenedor por ejecución.

## Cuentas y proyectos

Cada persona se registra con usuario y contraseña, y tiene su propio panel de proyectos:

- **Tuyos**: los que creaste. Podés renombrarlos, borrarlos y copiar su link.
- **Compartidos con vos**: los de otras personas que abriste alguna vez por link.

Cada proyecto tiene un **ID único de 12 caracteres** (alfabeto sin `0/O` ni `1/l/I`, para poder dictarlo en voz alta) y su link es `/p/<id>`. Cualquiera con el link y una cuenta puede abrirlo y editar en vivo; **solo el dueño** puede renombrarlo o borrarlo — eso se valida en el servidor, no solo en la interfaz.

Las contraseñas se guardan con `scrypt` (nunca en texto plano) y la sesión dura 30 días en un token firmado con HMAC.

### Configuración necesaria

Necesita una base Postgres. El disco del plan free de Render se borra en cada redeploy, así que guardar ahí perdería todas las cuentas: por eso el estado va a una base externa (una gratis de [Neon](https://neon.tech) o [Supabase](https://supabase.com) alcanza).

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La cadena de conexión de tu Postgres (`postgresql://usuario:clave@host/base`) |
| `SESSION_SECRET` | *(opcional)* secreto para firmar sesiones. Si no está, se deriva de `DATABASE_URL` |
| `DATABASE_SSL` | *(opcional)* `off` para conectarte a un Postgres local sin TLS |

Las tablas se crean solas al arrancar. Sin `DATABASE_URL` el editor arranca igual pero sin cuentas ni proyectos guardados (modo suelto, para probar).

**Nota sobre Supabase**: usá la cadena del **Session pooler** (la "Direct connection" es solo IPv6 y Render no la alcanza), y si la contraseña tiene caracteres especiales, codificalos en la URL (`/` es `%2F`, `@` es `%40`).

### Por qué las tablas quedan cerradas

Supabase publica el schema `public` por una API REST automática. Sin protección, cualquiera con la *anon key* del proyecto podría leer la tabla `users` — hashes de contraseñas incluidos — o borrar proyectos ajenos **sin pasar por este servidor**. Lo verifiqué contra un Postgres con los mismos roles que usa Supabase: se podía leer y borrar todo.

Por eso `initSchema()` cierra las tablas al arrancar: activa RLS sin políticas y revoca los permisos de los roles `anon`/`authenticated`. El backend se conecta como dueño de las tablas, y el dueño no queda sujeto a RLS, así que sigue funcionando sin cambios. Esto también hace desaparecer los avisos "RLS Disabled in Public" del Security Advisor de Supabase.

## Guardar el workspace en GitHub

El botón **Guardar** commitea *todos* los archivos del proyecto actual a este mismo repo (`saves/<id-del-proyecto>/<archivo>`, en una branch separada — `code-saves` por defecto — para no ensuciar el historial de desarrollo), en un único commit. Al entrar a un proyecto vacío, si hay una versión guardada la carga automáticamente en vez del ejemplo por defecto.

Es opcional y se degrada bien: sin configurar nada, el botón queda visible pero avisa que no está habilitado. Variables necesarias (mismo lugar que `APP_PASSWORD`, nunca las pongas en `render.yaml` ni las commitees):

| Variable | Valor |
|---|---|
| `GITHUB_TOKEN` | Un [Personal Access Token](https://github.com/settings/tokens) (fine-grained, con permiso *Contents: Read and write* sobre este repo) |
| `GITHUB_REPO` | `sant1jmnz/Laboratorio` |
| `GITHUB_SAVE_BRANCH` | *(opcional)* nombre de la branch donde guardar. Por defecto `code-saves`, se crea sola si no existe. |
| `APP_PASSWORD` | *(ya no se usa)* reemplazada por las cuentas de usuario. |

Nota: el contenido ya se guarda solo en Postgres mientras escribís, así que no hace falta apretar nada para no perder trabajo. Este botón es una copia extra en Git, útil para tener historial de versiones del código.

## Estructura

- `server/index.js`: servidor Express + WebSocket. Rutea `/run-ws` a la terminal interactiva, `/debug-ws` al depurador, y todo lo demás (`/docs/<id-del-proyecto>`) a la sincronización Yjs; ninguna conexión se acepta sin sesión válida.
- `server/sandbox.js`: baja privilegios de los procesos de usuario y les cede el directorio y la terminal.
- `server/db.js`: conexión a Postgres y creación del esquema.
- `server/accounts.js`: registro/login con `scrypt` y sesiones firmadas con HMAC.
- `server/projects.js`: alta, listado, permisos y persistencia del contenido de cada proyecto.
- `server/languages.js`: registro de lenguajes (extensiones, comando de compilación y de ejecución de cada uno).
- `server/build.js`: escribe el fuente en un directorio temporal aislado y lo compila si hace falta (sin usar shell).
- `server/debug-session.js`: sesiones de depuración con GDB en modo MI (breakpoints, step, variables, pila), con el programa en una pty aparte para no mezclar su E/S con la del debugger.
- `server/mi-parser.js`: parser del formato de salida MI de GDB.
- `server/interactive-run.js`: maneja las sesiones interactivas por WebSocket (spawn de la pty, límites de concurrencia, timeouts de inactividad y duración máxima, listado/descarga de archivos generados).
- `server/github-save.js`: guarda/carga el workspace completo de cada proyecto en este repo vía la Git Data API de GitHub (blobs + tree + commit, en un solo commit atómico).
- `client/debug-ui.js`: extensión de CodeMirror para la canaleta de breakpoints y el resaltado de la línea pausada.
- `client/main.js`: lógica del editor (CodeMirror + Yjs + terminal xterm.js + explorador de archivos + login), compilada a `public/bundle.js` con `npm run build`.
- `public/index.html`: estructura y estilos de la página.
