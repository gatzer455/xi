# 03 — Protocolo

Un solo canal: **WebSocket**. No hay REST — las operaciones request/response (sesiones, proyectos, archivos) viajan como invoke sobre el mismo WS. Principio rector: **no inventar un protocolo de chat nuevo** — los payloads hacia/desde pi son los mismos JSON que pi ya habla; xi-serve solo agrega auth y un mecanismo de invoke para sus comandos propios.

Sin versionado de protocolo: cliente y servidor se compilan del mismo repo, por la misma persona (piloto). Se agrega un frame `hello` con versiones cuando haya artefactos distribuidos por separado.

## Conexión

```
GET /ws?token=<token>
```

Token por query param — la API de WebSocket del navegador no permite headers custom. Token inválido o ausente → close inmediato. El tráfico viaja dentro del tailnet (cifrado por WireGuard); ver [05](05-conectividad-seguridad.md).

## Cliente → servidor

Dos formas, distinguidas por el shape del mensaje:

```json
{"type": "prompt", "message": "..."}          // comando pi → passthrough a stdin
{"id": 7, "method": "xi_list_sessions", "params": {...}}  // invoke → lo responde xi-serve
```

- **Comandos pi** (passthrough): `prompt`, `abort`, `get_state`, `get_messages`, `set_model`, `set_thinking_level`, `new_session`, etc. — exactamente lo que hoy arma el frontend para `send_pi_command`. `new_session` (crear una sesión nueva sin salir del proyecto activo) es uno de estos: no necesita validar whitelist porque ya estás en un cwd whitelisteado, así que **no** existe un `xi_new_session` aparte. Sin whitelist de tipos: quien tiene el token puede promptear al agente, que es estrictamente más poder que cualquier comando RPC; la contención real son approve-rules y la whitelist de proyectos.
- **Invoke `xi_*`** (interceptados por xi-serve, nunca llegan a pi) — se usan para todo lo que passthrough no puede: cambiar de proyecto/sesión (implica kill+respawn del proceso pi) o consultar cosas que pi no expone:

| Método | Qué hace |
|--------|----------|
| `xi_list_projects` | Proyectos whitelisteados del config |
| `xi_set_project` | Cambiar de proyecto activo (kill + respawn de pi, cwd validado contra whitelist) |
| `xi_list_sessions` | Sesiones de un proyecto (shell a `pi-sessions list`, mismo binario que usa desktop) |
| `xi_open_session` | Cambiar de sesión (kill + respawn de pi con `--session`, path validado) |
| `xi_list_files` / `xi_read_file` | Explorador read-only, solo dentro de proyectos whitelisteados |
| `xi_get_pi_version` / `xi_get_status` | Metadata del proceso pi |
| `xi_get_auth_status` | Nombres de providers configurados (nunca las keys) |

## Servidor → cliente

- Cada línea de stdout de pi se reenvía **tal cual**, sin envelope. El pipeline del frontend (event-parser → state-sync → streamer) las consume idéntico a desktop.
- Respuestas de invoke: `{"id": 7, "result": ...}` o `{"id": 7, "error": "..."}`.
- stderr de pi y terminación: frames propios (`pi_err`, `pi_terminated`) — como hoy.

## Reconexión: resync total

Las conexiones móviles mueren constantemente (pantalla bloqueada, WiFi→LTE, doze). El diseño lo asume:

1. pi sigue vivo en el server mientras el cliente está desconectado; la tarea continúa.
2. Al reconectar (backoff exponencial en `WsEventBus`, ya implementado), el cliente **descarta su estado local** y manda `get_state` + `get_messages`: reconstruye la conversación completa.
3. Es el mismo flujo que desktop ejecuta al abrir una sesión existente — código que ya existe en ambos lados. El `SmoothStreamer` renderiza el buffer completo por frame, así que el catch-up se ve suave, no como un re-render raro.

**Descartado:** ring buffer + números de secuencia + replay parcial. Es una optimización de ancho de banda (re-descargar solo lo perdido en vez de toda la conversación) que un piloto con un usuario y conversaciones de tamaño humano no necesita. Se reconsidera si el resync duele en la práctica — la señal será esperas notables al desbloquear el teléfono en sesiones largas.

## Extension UI remota (approve y ask)

pi emite `extension_ui_request` por stdout (aparece en el stream como cualquier evento) y espera la respuesta por stdin. En desktop, el backend Tauri intercepta y media; en mobile el flujo es más directo:

```
pi ──extension_ui_request──▶ xi-serve ──passthrough──▶ cliente (bottom sheet)
pi ◀───────stdin◀─────────── xi-serve ◀──passthrough── cliente (respuesta)
```

xi-serve intercepta todo `extension_ui_request` cuyo `method` sea uno de los interactivos (`select`, `confirm`, `input`, `editor` — los que usan `approve`/`ask` de xi-flow vía `ctx.ui.*`): lo guarda pendiente y arranca el timeout, **conectado o no** — un cliente conectado pero mirando para otro lado también debe resolver en deny. Métodos fire-and-forget (`notify`, `setStatus`, etc.) pasan de largo: no esperan respuesta, así que no se encolan (encolarlos los re-dispararía en cada reconexión).

Con timeout configurable (`approveTimeoutSecs` en el config, default 600s) responde **denegar**: escribe `{"type": "extension_ui_response", "id": <id>, "cancelled": true}` a stdin de pi — el mismo shape que usa el frontend de desktop para sus propios timeouts/cancelaciones (`respondWithCancelled` en `extension-ui-handler.ts`). `{cancelled: true}` es la respuesta segura tanto para `approve` (deniega) como para `ask` (cancela la pregunta) — un agente desatendido jamás se destraba solo hacia el lado permisivo.

Al (re)conectar, el cliente recibe cualquier request interactivo aún pendiente (no solo los nuevos que lleguen después).
