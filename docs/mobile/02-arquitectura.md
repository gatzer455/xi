# 02 — Arquitectura

## Punto de partida: cómo funciona xi desktop hoy

```
Frontend (WebView)          Tauri Core (Rust)            pi sidecar
──────────────────          ─────────────────            ──────────
PiEventBus.sendCommand ───▶ pi_rpc.rs
                             stdin.write(jsonl) ────────▶ pi --mode rpc
PiEventBus (eventos) ◀────── app.emit("pi:raw", line)
                             stdout.read_line() ◀──────── (eventos JSONL)
```

El backend Tauri hace tres cosas con pi: ciclo de vida (`pi_process.rs`), pipe bidireccional (`pi_rpc.rs`), e intercepción de extension UI. **Nada de eso requiere Tauri** — es gestión de procesos + pipe de líneas JSON. Un daemon de red hace exactamente lo mismo: eso es xi-serve.

Opciones descartadas en la exploración: wrapper sobre SSH (hereda la fragilidad que motiva el proyecto) y exponer pi crudo por TCP (sin auth ni sesiones; al agregarlas ya es un daemon).

## Arquitectura elegida

```
┌─ celular ────────────┐        tailnet         ┌─ homeserver ──────────────────────────┐
│                      │                        │                                        │
│  xi mobile           │   WebSocket único      │  xi-serve (daemon Rust)                │
│  (app Tauri 2)       │◀══════════════════════▶│  ├─ auth: token estático               │
│                      │   passthrough pi       │  ├─ session manager ──▶ pi --mode rpc  │
│  UI compartida vía   │   + invoke xi_*        │  ├─ whitelist de proyectos             │
│  packages/xi-ui      │                        │  ├─ extension_ui pendiente (encolado)  │
│                      │                        │  └─ ensure_extensions() al arrancar    │
└──────────────────────┘                        │                                        │
                                                │  ~/.pi/ (sesiones, auth, extensiones)  │
                                                │  proyectos whitelisteados              │
                                                └────────────────────────────────────────┘
```

xi-serve está escrito en **Rust** (tokio + tokio-tungstenite) — decidido e implementado; la alternativa Bun/TS se descartó al preferir un binario sin runtime adicional en el server.

## Responsabilidades de xi-serve

| Módulo | Qué hace | Análogo actual |
|--------|----------|----------------|
| **Auth** | Token estático generado al primer arranque; validado en el handshake WS. Ver [05](05-conectividad-seguridad.md). | no existe (IPC local) |
| **Session manager** | Un proceso pi por vez; kill + respawn con `--session <path>` al cambiar de sesión (mismo modelo que desktop). pi sigue vivo entre conexiones del cliente. | `pi_process.rs` |
| **Whitelist de proyectos** | Lista de working dirs permitidos en el config. Todo cwd de sesión se valida contra ella. | no existe |
| **Extension manager** | `ensure_extensions()` al arrancar: instala/actualiza xi-tools, xi-exa y xi-flow en `~/.pi/agent/extensions/`. Crítico en un homeserver sin xi desktop: sin xi-flow no hay approve, y sin approve no hay supervisión remota. | `extensions.rs` |
| **RPC bridge** | Passthrough de comandos pi (texto plano → stdin) + comandos propios `xi_*` (JSON con `id` → respuesta con `id`). | `pi_rpc.rs` |
| **Extension UI pendiente** | Si pi emite `extension_ui_request` sin cliente conectado: guardar, re-entregar al conectar, timeout configurable → denegar. | intercepción en `pi_process.rs` |
| **Archivos read-only** | Listar/leer archivos dentro de proyectos whitelisteados (explorador móvil). | `files.rs` |

Deliberadamente fuera: gestión de API keys por red (se configuran en el servidor), escritura de archivos desde la UI, edición de approve-rules, replay con secuencias (ver [03](03-protocolo.md)), servir una PWA, push (futuro: ntfy).

## Modelo de sesiones y concurrencia

- **Un cliente WS a la vez** (un teléfono) es el uso previsto. El servidor no lo fuerza — no hay razón para rechazar una segunda conexión — pero el diseño (una sola whitelist, un solo pi activo) asume un dueño con un dispositivo por sesión.
- **pi es un proceso persistente del servidor, no de la conexión**: se spawnea una vez al arrancar xi-serve (y se mata + respawnea con `--session` al cambiar de sesión o proyecto), nunca al aceptar un WS. Su stdout se difunde a todos los clientes conectados vía un canal broadcast — así una desconexión de cliente no mata el lector de stdout ni pierde la próxima línea.
- **Un proceso pi por vez**, atado a la sesión activa. Cambiar de sesión = kill + respawn con `--session` — el mismo modelo probado de desktop.
- **pi sobrevive a las desconexiones del cliente**: lanzar una tarea, bloquear el teléfono, y el agente sigue trabajando. Al volver, resync ([03](03-protocolo.md)).
- **Desktop y homeserver son máquinas distintas** con `~/.pi` distintos: no comparten sesiones, no hay conflicto de JSONL. "xi desktop como cliente de xi-serve" queda como idea futura con diseño propio.

## Qué NO cambia en pi

Nada. pi ya expone todo lo necesario (`--mode rpc`, `--session`, comandos JSON, eventos JSONL, extension UI API). xi-serve es un consumidor más de esa interfaz, igual que el backend Tauri.
