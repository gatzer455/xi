# Arquitectura

xi separa la interfaz del motor en dos procesos que se comunican por JSONL.
El frontend no sabe si habla con pi por IPC local o por WebSocket remoto:
`PiEventBus` abstrae el transporte.

```
┌──────────────────────────┐      ┌───────────────────┐      ┌──────────────┐
│  WebView (Tauri)         │ IPC  │  Backend (Rust)    │      │  pi sidecar  │
│                          │◄────►│                    │◄────►│              │
│  SolidJS + Vite          │      │  Tauri 2           │      │  bun binary  │
│  PiEventBus (frontend)   │      │  Comandos IPC      │      │  --mode rpc  │
│  ChatStore + SmoothStream│      │  Extensiones       │      │  stdin/stdout│
│  Panel system (CSS Grid) │      │  Sidecar lifecycle │      │  JSONL       │
└──────────────────────────┘      └───────────────────┘      └──────────────┘
                                            │
                                   ┌────────┴────────┐
                                   │  xi-serve (WS)  │  ←── Android WebView
                                   │  Rust daemon    │       (SolidJS +
                                   │  passthrough    │        xi-ui package)
                                   └─────────────────┘
```

## Capas

### Frontend (apps/desktop/frontend)

| Capa | Responsabilidad |
|------|----------------|
| Pages / Components | DOM, render, eventos de usuario |
| Lib | Lógica pura, llama comandos Tauri |
| State | Signals globales (`xi-ui/lib/state.ts`) |
| Transport | `PiEventBus` (TauriEventBus / WsEventBus) |

### Backend (apps/desktop/backend)

| Módulo | Responsabilidad |
|--------|----------------|
| `main.rs` | Setup de Tauri, plugins, comandos |
| `commands/pi_rpc.rs` | Comunicación stdin/stdout con pi |
| `commands/pi_process.rs` | Ciclo de vida del sidecar |
| `commands/pi_sessions.rs` | Gestión de sesiones |
| `commands/auth_config.rs` | API keys de proveedores |
| `commands/files.rs` | File tree para el explorador |
| `extensions.rs` | Instalación de extensiones empaquetadas |

### Paquete compartido (packages/xi-ui)

Código transporte-agnóstico que corre igual en desktop y mobile:
- `lib/chat/` — stores, reducer, types, state-sync
- `lib/pi/` — transport, event-parser, tauri-commands
- `lib/smooth-streamer.ts` — renderizado incremental de markdown
- `lib/markdown.ts` — parseo de markdown a HTML
- `lib/state.ts` — signals globales con tipos nominales
- `styles/` — tokens, tema, markdown, componentes

## Pipeline de streaming

```
pi (stdout JSONL) → PiEventBus → state-sync (throttle ~20/s)
  → ChatStore → SmoothStreamer (rAF, buffer growth-only)
  → reconcileDom (diff HTML vs DOM actual) → .fade-in en bloques nuevos
```

## Sistema de paneles

CSS Grid con 4 templates fijos según cantidad de paneles (1–4).
Cada panel tiene su propio tipo (`chat`, `explorer`, `sessions`) y su propio
`ChatStore`. Los paneles se crean con Ctrl+Shift+O y se cierran con
Ctrl+Shift+W.

## Mobile

La app Android (apps/mobile) usa el mismo paquete `xi-ui` para pipeline de
chat y estilos. En vez de IPC Tauri, se conecta por WebSocket a `xi-serve`,
que spawnea pi en un servidor remoto. El frontend es idéntico en capacidades:
la abstracción `PiEventBus` hace que desktop y mobile compartan el mismo
código de chat, streaming y state-sync.
