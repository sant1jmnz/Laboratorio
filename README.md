# Editor colaborativo en tiempo real

Editor de código donde varias personas pueden escribir a la vez y ver los cambios de las demás al instante (cursores incluidos), como Google Docs pero para código.

## Cómo funciona

- **Yjs**: estructura de datos CRDT que sincroniza el texto entre todos los clientes sin conflictos, aunque escriban al mismo tiempo.
- **y-websocket**: servidor y proveedor de WebSocket que retransmite los cambios de Yjs entre clientes conectados a la misma "sala".
- **CodeMirror 6** + **y-codemirror.next**: editor de código en el navegador, con resaltado de sintaxis y cursores remotos coloreados por usuario.

Todo el frontend se carga vía CDN (esm.sh) con un `importmap`, así que no hace falta bundler.

## Uso

```bash
npm install
npm start
```

Abrí `http://localhost:3000` en varias pestañas o desde otras computadoras (usando la IP del server). Todos los que entren a la misma "sala" (campo de texto arriba a la izquierda, o `?room=nombre` en la URL) editan el mismo documento en tiempo real.

Para compartir con otra persona en otra red, hay que exponer el puerto 3000 (por ejemplo con un túnel como `ngrok http 3000`) o desplegar el server en algún hosting.

## Estructura

- `server/index.js`: servidor Express + WebSocket que sirve el frontend estático y hace de backend de sincronización Yjs.
- `public/index.html` y `public/main.js`: editor en el navegador.
