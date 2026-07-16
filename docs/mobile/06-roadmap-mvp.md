# 06 — Roadmap de implementación

Fases secuenciales; cada una termina en algo verificable por sí solo. La fase 0 (spike passthrough) ya ocurrió: es el xi-serve actual + `WsEventBus` de la rama `feat/mobile-v2` — validó que pi → red → WebView funciona.

## Fase 1 — Servidor completo (sin tocar frontend) ✅

`packages/xi-serve` creció a lo decidido. Verificado con un cliente WS de prueba (Node, `new WebSocket(...)` nativo) desde localhost — mismo protocolo que websocat, sin depender de tenerlo instalado.

- **Token**: se genera al primer arranque en `~/.pi/config/xi-serve.json`, se valida en el handshake (`GET /ws?token=…` vía `accept_hdr_async`, rechazo con 401 antes de upgradear la conexión).
- **Whitelist de proyectos** en el mismo config (+ `--cwd` de la CLI, solo en memoria); `xi_list_projects`; `xi_set_project`/`xi_open_session`/`xi_list_files`/`xi_read_file` validan contra ella.
- **`ensure_extensions()`** portado a `xi-serve/src/extensions.rs`: busca el bundle junto al binario (`<exe_dir>/extensions/`, sin `AppHandle`/`resource_dir` de Tauri). Si falta xi-flow, xi-serve **se niega a arrancar** (exit 1) — sin la red de seguridad de approve/ask no hay supervisión remota.
- **pi como proceso persistente del servidor**: se spawnea una vez al arrancar (y en cada `xi_set_project`/`xi_open_session`), no por conexión. Su stdout se difunde por un `broadcast::channel` a todos los clientes conectados — así una desconexión no mata el lector ni pierde lo que pi siga emitiendo.
- **Sesiones**: `xi_open_session` (kill + respawn con `--session`, path validado). `xi_list_sessions` shellea a `pi-sessions list <cwd>` (el mismo sidecar que usa desktop) y pasa su JSON tal cual — sin reimplementar el parseo de JSONL ni el merge de settings. No hay `xi_new_session`: crear sesión sin cambiar de proyecto es el comando pi `new_session`, pasthrough normal.
- **Archivos read-only**: `xi_list_files`, `xi_read_file` (puerto de `files.rs` de desktop, menos `write_file`) dentro de la whitelist.
- **Extension UI pendiente**: intercepta `extension_ui_request` con método interactivo (`select`/`confirm`/`input`/`editor`), lo encola y re-entrega al (re)conectar, deniega con `{cancelled: true}` al timeout (`approveTimeoutSecs`, default 600s) haya o no cliente conectado. Métodos fire-and-forget (`notify`, `setStatus`) no se encolan.

**Gate — verificado:** autenticar, listar proyectos/sesiones/archivos, leer un archivo, promptear, ver streaming, cortar la conexión a mitad de respuesta, reconectar y resincronizar con `get_messages` (llega completo, incluyendo lo que pi generó mientras el cliente estaba desconectado). Forzar la tool `ask` (dispara un `extension_ui_request` real), cortar sin responder, reconectar (se re-entrega el mismo request pendiente) y esperar el timeout: xi-serve deniega, el agente recibe "(cancelled)" y continúa. Conexión con token inválido: rechazada en el handshake.

## Fase 2 — Paquete compartido `packages/xi-ui` ✅

Extraído de `apps/desktop/frontend/src` lo transporte-agnóstico: `lib/chat/`, `lib/pi/` (interfaz + parser + state-sync + types), `smooth-streamer`, `signal`, `nav`, markdown, componentes de chat, y `styles/` (tokens, theme, markdown, components). Desktop lo consume vía alias de Vite/TS (`xi-ui/*` → `packages/xi-ui/src/*`) — no hay npm workspaces en este repo, `xi-ui` es un proyecto standalone con su propio `package.json`/`node_modules` (necesario porque algunos módulos movidos importan npm packages — `@tauri-apps/plugin-log`, `markdown-it` — y la resolución camina desde la ubicación real del archivo, no desde el alias).

Dos ajustes sobre el plan original, decididos durante la implementación:
- **`state.ts` y `debug-panel.ts` también se movieron** (no estaban en la lista original). `state-sync.ts` los importa directo (`appState`, `addEntry`); separarlos hubiera exigido inyectar dependencias sin necesidad real — y ambos son igual de válidos para mobile (Tauri en Android también).
- **`ws-event-bus.ts` fue a `xi-ui`, no a `apps/mobile`** — esa app todavía no tiene un `src/` frontend (Fase 3 no arrancó), y crear el scaffolding solo para alojar un archivo hubiera sido adelantar trabajo. Se re-ubica cuando Fase 3 lo necesite.
- **`WsEventBus`, `mobile.ts` y `__XI_SERVE_URL__` salieron del código desktop** (mobile.ts murió; el resto de las referencias a modo remoto en `main.ts`/`workdir.ts`/`welcome.ts`/`init.ts` se eliminaron, no solo se movieron).
- **No se tocó** `layout.css`/`base.css`/`pages.css` — la regla de spacing `.chat-messages > .message + .message` se dejó en `layout.css` (desktop) en vez de moverla a `components.css`: está atada a una clase de contenedor que mobile todavía no diseñó, generalizarla ahora hubiera sido especulativo.

**Gate — verificado:** `tsc --noEmit` limpio, 271/271 tests de vitest en verde, `vite build` produce un bundle único sin errores de resolución (JS vía alias, CSS vía paths relativos a `packages/xi-ui/src/styles/`), dev server sirve los archivos de `xi-ui` con 200 (`server.fs.allow`), welcome page renderiza contenido correcto en preview de browser. **Pendiente de verificar por el usuario:** streaming/sesiones/approve end-to-end en la app Tauri real (el preview de browser no tiene IPC de Tauri, así que esos flujos no se probaron interactivamente) — correr `npm run dev` desde la raíz.

## Fase 3 — App móvil 🚧 (vertical slice hecho, falta build Android real)

`apps/mobile/frontend` con entry point y build propios sobre `xi-ui` — ver `apps/mobile/CLAUDE.md` y `apps/mobile/frontend/CLAUDE.md` para el detalle completo.

- ✅ Pantalla de conexión/settings: URL + token → localStorage (`ConnectPage` + `connection-storage.ts`).
- ✅ Navegación apilada: proyectos → sesiones → chat. Reusa `appState.currentView`/`navigate()` de xi-ui (se sumaron `'connect'`/`'projects'` al `ViewName` compartido) en vez de un router propio.
- ✅ Chip de estado de conexión (`connected/reconnecting/offline`, poll de 1s sobre `WsEventBus.connectionState`).
- ✅ Chat con streaming (pipeline compartido: ChatStore, SmoothStreamer, ChatBubble) + resync al reconectar (`get_state`+`get_messages` cuando el poll detecta `reconnecting/offline → connected`).
- ✅ Approve/ask como bottom sheet (`position: fixed`, en vez del inline de desktop).
- ✅ Explorador read-only.

**Descubrimiento al arrancar la fase:** `tauri-commands.ts` (los wrappers de comandos hacia pi/xi-serve) ya tenía el dual-routing `isMobile`/`commandBus` completo de una sesión anterior, pero vivía mal ubicado en `apps/desktop/frontend` — se movió a `packages/xi-ui` (mismo tratamiento que `state.ts`/`debug-panel.ts` en Fase 2). `scope.ts` (helper de disposers de pages) se movió por la misma razón: ambas apps lo necesitan y es puro. Dos stubs vacíos (`listFiles`/`readFile` en modo mobile) se completaron para invocar `xi_list_files`/`xi_read_file`; se agregaron `listProjects()`/`openSession()`, que no existían.

**Gate — verificado manualmente:** conectar a un xi-serve real (`cargo run -- --cwd <proyecto>`), listar el proyecto whitelisteado, listar sesiones reales (`pi-sessions list` de este mismo repo), abrir una con historial real (thinking blocks, tool calls, respuesta completa renderizados correctamente), enviar un prompt nuevo y recibir streaming real end-to-end. `tsc --noEmit` + `vitest run` (9 tests) verdes en `apps/mobile/frontend`; 271 tests de desktop siguen en verde.

**Bugs reales encontrados durante la prueba (fuera del alcance de este scaffold, delegados por separado):** `setStatus` (método fire-and-forget de xi-flow, igual que `notify`) no estaba contemplado ni en mobile ni en desktop — se corrigió acá; desktop tiene el mismo bug pendiente. El comando passthrough `get_models` que usa `getAvailableModels()` es rechazado por la versión actual de pi ("Unknown command") — probablemente un nombre de RPC desactualizado, afecta a ambas apps por igual, pendiente de investigar.

**Pendiente:** build Android real (`apps/mobile/src-tauri/gen/android`) contra el homeserver real, validar streaming en Android System WebView (riesgo señalado en [04](04-cliente-movil.md); plan B: bajar el throttle de eventos para el cliente móvil), rename/delete de sesiones (deliberadamente fuera del MVP).

## Fase 4 — Uso real y cierre

Usarlo a diario. Ajustar lo que duela. Sincronizar CLAUDE.md (raíz, frontend, xi-serve) con la estructura final.

## Later / ideas en estudio

| Idea | Notas |
|------|-------|
| Push (ntfy self-hosted) | Approve pendiente, turno terminado, pi crasheó. Primera candidata post-piloto. |
| Replay con secuencias | Solo si el resync total duele en sesiones largas — medir antes. |
| Pairing QR + device tokens | Cuando haya más de un dispositivo que importe distinguir. |
| xi desktop como cliente de xi-serve | Cambio de modelo de deployment; merece diseño propio. |
| Biometría al abrir la app | Plugin Tauri; junto con guardar el token en keystore. |
| Adjuntar fotos desde el celular | Posiblemente la feature móvil más valiosa después del approve. |
| Multi-cliente simultáneo | Celular + tablet sobre la misma sesión. |
| Log de auditoría | Comandos y approvals con dispositivo y resolución, JSONL rotado. |

## Riesgos principales

| Riesgo | Mitigación |
|--------|------------|
| WebView de Android rinde mal con el streaming | Validar apenas el chat móvil renderice (fase 3, primer ítem). Plan B: throttle más agresivo para móvil. |
| El refactor `xi-ui` rompe sutilmente el desktop | Gate de fase 2: suite completa + smoke manual antes de seguir. |
| Scope creep hacia "xi web multiusuario" | Los no-objetivos de [01](01-vision.md) son el contrato: un dueño, sus dispositivos, cero internet público. |
