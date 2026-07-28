# xi

Interfaz de escritorio para [pi](https://github.com/earendil-works/pi-coding-agent),
el agente de inteligencia artificial de [Mario Zechner](https://mariozechner.at/).

xi es una ventana para usar pi sin tocar la terminal. Abrís un proyecto,
escribís lo que necesitás y pi responde con streaming en vivo, ejecuta
herramientas, analiza archivos y redacta documentos.

![v0.4.0](https://img.shields.io/badge/version-0.4.0-6716dd)
[![Release](https://github.com/gatzer455/xi/actions/workflows/release.yml/badge.svg)](https://github.com/gatzer455/xi/actions/workflows/release.yml)
[![CI](https://github.com/gatzer455/xi/actions/workflows/ci.yml/badge.svg)](https://github.com/gatzer455/xi/actions/workflows/ci.yml)

---

## Captura

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Shell | [Tauri 2](https://v2.tauri.app) |
| Backend | Rust |
| Frontend | TypeScript + [SolidJS](https://www.solidjs.com) + Vite |
| Motor | pi (sidecar, `--mode rpc`) |
| Markdown | [solid-markdown](https://github.com/oscartbeaumont/solid-markdown) |
| Matemáticas | [KaTeX](https://katex.org) |
| Mobile | Tauri 2 Android + WS remoto |

---

## Funcionalidades

**Chat con streaming** — los tokens aparecen mientras pi genera la respuesta.
Pi puede pensar, ejecutar herramientas, leer/escribir archivos y mostrar el
resultado en vivo.

**Gestión de sesiones** — varias conversaciones separadas. Pestañas en la
barra superior, como un navegador. Crear, renombrar y eliminar.

**Sistema de paneles** — dividí la ventana en hasta 4 paneles para ver
varios chats o el explorador al mismo tiempo.

**Ajustes** — modelo, nivel de razonamiento, API keys (Anthropic, OpenAI,
Google, OpenRouter, Groq, DeepSeek, OpenCode Go), tema claro/oscuro,
tamaño de fuente.

**Explorador de archivos** — navegá y editá archivos del proyecto.
Árbol de directorios con vista previa de texto.

**Extensiones** — xi-tools (shell + archivos sin depender del sistema),
xi-exa (búsqueda web), xi-flow (aprobación interactiva de comandos).

**Actualizaciones automáticas** — firmadas con minisign, vía GitHub Releases.

**Mobile** — app Android (Tauri 2) que se conecta a [xi-serve](packages/xi-serve/)
en un homeserver vía Tailscale. Chat completo con streaming remoto.

---

## Cómo arrancar

### Usuarios

Descargá el instalador para tu sistema desde
[GitHub Releases](https://github.com/gatzer455/xi/releases/latest):

| Plataforma | Formato |
|-----------|---------|
| Linux | `.deb` (amd64) |
| Windows | `.exe` (NSIS) / `.msi` |
| macOS | `.dmg` (Apple Silicon / Intel) |

La app se actualiza sola cuando hay una versión nueva.

### Desarrollo

Ver [docs/dev.md](docs/dev.md) — necesitás Bun, Rust y las librerías de
sistema de Tauri.

```bash
git clone https://github.com/gatzer455/xi.git
cd xi
cd apps/desktop/frontend && bun install && cd ../..
cd packages/xi-ui && bun install && cd ..
cd apps/desktop/frontend && bun run dev
```

---

## Arquitectura en 30 segundos

xi separa la interfaz del motor en dos procesos que se comunican por JSONL:

```
┌─────────────────────┐     ┌──────────────────┐     ┌────────────┐
│  WebView (SolidJS)  │ IPC │  Tauri (Rust)    │     │  pi        │
│  UI, streaming,     │◄───►│  comandos,       │◄───►│  agente    │
│  paneles, settings  │     │  lifecycle,       │     │  LLM +     │
│                     │     │  extensiones      │     │  tools     │
└─────────────────────┘     └──────────────────┘     └────────────┘
```

Para mobile, el Tauri IPC se reemplaza por WebSocket (xi-serve):

```
┌───────────────────┐     ┌──────────────┐     ┌────────────┐
│  Android WebView   │ WS  │ xi-serve     │     │  pi        │
│  (SolidJS +        │◄───►│  Rust daemon │◄───►│  agente    │
│   xi-ui compartido)│     │  passthrough │     │            │
└───────────────────┘     └──────────────┘     └────────────┘
```

El frontend no sabe si está hablando con pi por IPC local o por WebSocket
remoto — la interfaz `PiEventBus` abstrae el transporte.

---

## Proyectos relacionados

| Proyecto | Qué hace |
|----------|---------|
| [pi](https://github.com/earendil-works/pi-coding-agent) | Motor de IA, agente de código |
| [xi-tools](packages/xi-tools/) | Shell + archivos cross-platform |
| [xi-exa](packages/xi-exa/) | Búsqueda web vía Exa API |
| [xi-flow](packages/xi-flow/) | Flujo interactivo (approve, ask) |
| [xi-serve](packages/xi-serve/) | Daemon WS para acceso remoto |
| [xi-ui](packages/xi-ui/) | Pipeline de chat + estilos compartidos |

---

## Licencia

MIT
