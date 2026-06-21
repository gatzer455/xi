# Plan de desarrollo — xi

Interfaz de escritorio para pi, dirigida a usuarios no-técnicos. Tauri 2 + Vanilla TypeScript + pi como motor via RPC.

---

## Estado actual

**Última etapa completada:** Tests E2E + español neutro + pi-approve (extensión standalone)

**Siguiente:** Integrar pi-approve en la UI de xi

---

## Completado

| Etapa | Feature | Commits |
|-------|---------|---------|
| 0 | Fundamentos del proyecto | — |
| 1 | Patrón de 4 capas (signal, state, router) | — |
| 2 | Sidecar pi (RPC JSONL) | — |
| 3 | Chat funcional (streaming, thinking blocks) | — |
| 4 | Sesiones (list, switch, rename, delete) | — |
| 5 | Tool calls + thinking blocks | — |
| 6 | Settings (modelo, thinking, tema, font) | — |
| 7 | Auto-update (updater plugin, CI workflow) | — |
| 8 | Versiones (xi + pi en About) | — |
| 9 | Onboarding (API keys, welcome, providers) | — |
| ✨ | Extension UI handler (intercepta requests de pi) | `290a2f2` |
| ✨ | Welcome → Sessions flow | `dbc9b49` |
| ✨ | LaTeX math (temml + Noto Sans Math) | `928c42b` |
| ✨ | File Explorer (ver + editar archivos) | `ad2d3e0` |
| ✨ | Tests unitarios (50 tests) | `2323a27` |
| ✨ | README (Diataxis + retórica hispánica) | `a0b4d47` |
| ✨ | CHANGELOG (Keep a Changelog) | `36b9f2c` |
| ✨ | E2E tests + CI | `d9ae007` `a96ffd1` |
| ✨ | Sesiones corruptas (skipped) + tests A–E | `d6e6c98` |
| ✨ | Español neutro latino + crédito a pi | `0d07c41` |

---

## Pendiente — Prioridad

### 🔴 Alta

| # | Feature | Descripción | Estado |
|---|---------|-------------|--------|
| 1 | **pi-approve en UI** | La extensión existe (`~/.pi/agent/extensions/pi-approve/`) y funciona en TUI. Verificado: `tool_call` → `ctx.ui.select()` → dialog en xi → respuesta a pi. | ✅ Funciona |
| 2 | E2E tests | `tauri-driver` + WebDriverIO, flujo completo | `14` tests |
| 3 | CI | GitHub Actions (build + test en push) | Workflow listo, falta push |

### 🟡 Media

| # | Feature | Descripción | Dependencias |
|---|---------|-------------|--------------|
| 4 | Nombre de sesiones | Auto: fecha, prompt al crear, o híbrido | Ninguna |
| 5 | Versión real en settings | `app.getVersion()` en vez de hardcoded | Ninguna |
| 6 | Release notes inline | Body del update en settings | Ninguna |



---

## Ideas futuras (no comprometidas)

- **Multi-ventana** — Por ahora una ventana. Evaluar si el usuario lo pide.
- **Terminal embebida** — Output de herramientas colapsable (ya hecho parcialmente en chat).
- **Imágenes en explorer** — Preview de archivos de imagen.
- **Crear/eliminar archivos** — Scope v2 del explorer.
- **Integración explorer ↔ chat** — Enviar archivos al chat.

---

## Pendientes técnicos

### Updater (Etapa 7 — pendientes)

- [ ] Llenar `endpoints` con URL real del repo GitHub
- [ ] Configurar GitHub Secrets (TAURI_SIGNING_PRIVATE_KEY)
- [ ] `app.getVersion()` en settings (hoy hardcoded)
- [ ] Cross-compile sidecar a Windows
- [ ] macOS codesign + notarization (Apple Developer ID, $99/año)

### Notas de implementación

- **pi-approve** → extensión de pi para aprobar/rechazar tool calls peligrosos. Ya existe en `~/.pi/agent/extensions/pi-approve/`. Usa `ctx.ui.select()` para preguntar al usuario. Verificado que funciona en xi.
- **Extension UI** → ya implementado (`extension-ui-handler`), pero posiblemente no intercepta correctamente los requests de pi-approve.
- **Rewrite ask tool** → ya hecho (standalone en `~/.pi/agent/extensions/pi-ask/`).

---

## Decisiones técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Motor | pi via `--mode rpc` | JSONL estable, separación de concerns |
| Framework desktop | Tauri 2 | Rust core, WebView nativo, ~3MB vs ~96MB Electron |
| Frontend | Vanilla TypeScript + Vite | 0 dependencias runtime, patrón de 4 capas |
| Reactividad | Signal<T> propio (~25 LOC) | Cero mantenimiento |
| Markdown | markdown-it + temml | MathML nativo, plugins |
| CSS | Custom properties + tokens | Cero mantenimiento |
| Sidecar pi | Binario bun-compiled | Actualizable independientemente |
| Extensiones | Copiar a `~/.pi/agent/extensions/` | Auto-discovery de pi |

---

## Arquitectura rápida

```
xi/
├── frontend/          ← UI (Vanilla TS + Vite)
│   └── src/
│       ├── lib/       ← signal, state, nav, markdown, pi/
│       ├── components/← chat-bubble, header, input, extension-ui-dialog, file-list, file-preview
│       ├── pages/     ← chat, sessions, settings, welcome, explorer
│       └── styles/    ← tokens.css, temml.css
│
├── backend/           ← Tauri core (Rust)
│   └── src/commands/  ← pi_process, pi_rpc, files, auth_config, extension_ui, pi_sessions, pi_version
│
└── .develop/          ← Pipeline de diseño
    ├── 01-idea/
    ├── 02-design/
    └── 03-reqs/
```

---

## Stack

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Desktop | Tauri | 2.x |
| Backend | Rust | stable |
| Frontend | TypeScript + Vite | 5+ / 8+ |
| Motor | pi | sidecar binario |
| Markdown | markdown-it + temml | — |
| Math font | Noto Sans Math | 293KB |
| State | Signals propias | ~25 LOC |
| Routing | Hash-based propio | ~80 LOC |

---

## Cronograma estimado (restante)

| Tarea | Duración |
|-------|----------|
| pi-approve | ✅ Funciona |
| E2E tests | 1 día |
| CI (push) | 1 hora |
| **Total** | **1-2 días** |
