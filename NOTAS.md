# NOTAS — xi

Ideas, decisiones pendientes, y temas a pulir que surgen durante el desarrollo.
No son compromisos, son capturas para no olvidar.

---

## Nombre de sesiones — ¿amigable o prompt?

**Contexto:** pi asigna a cada sesión un nombre críptico (basado en su
sessionId UUID, ej. `a3f8c9d1-...`). Como nombre de tab en el top bar
del browser-shaped layout, no es legible.

**Opciones discutidas (Etapa de pulir UI, no ahora):**

1. **Auto: fecha de creación** — ej. `2026-06-18 14:32`. Cero fricción,
   siempre legible. El usuario lo puede renombrar después (ya existe la
   lógica de `handleRename` en sessions.ts).
2. **Prompt al crear** — el modal de "+ Nueva conversación" pide un
   nombre, con la fecha como default. Más fricción, mejor DX.
3. **Híbrido** — fecha como default, prompt solo si el usuario quiere
   renombrar antes de crear. Botón "Renombrar" en la tab.

**Decisión:** pospuesto para la fase de pulir interfaz. Por ahora se
usa el nombre de pi. Anotado para no perderlo.

---

## Activar el updater de xi (Etapa 7) — pasos finales

**Contexto:** el updater está implementado y commiteado, pero `endpoints: []`
en `backend/tauri.conf.json` (placeholder hasta que exista el repo de releases).
Tampoco hay repo de GitHub configurado todavía, ni secrets de CI. Cuando llegue
el momento de hacer el primer release, hay que hacer estos pasos.

### Pasos

1. **Crear el repo de xi en GitHub** (público o privado según se decida).
2. **Llenar el endpoint** en `backend/tauri.conf.json`:
   ```json
   "endpoints": [
     "https://github.com/{owner}/{repo}/releases/latest/download/latest.json"
   ]
   ```
3. **Rotar la key de dev** (la que está embebida ahora es de `~/.tauri/xi.key`
   con passphrase de dev). Generar una nueva para producción:
   ```bash
   npx tauri signer generate -w ~/.tauri/xi.prod.key -p "<passphrase-fuerte>"
   ```
   Copiar el contenido de `xi.prod.key.pub` a `plugins.updater.pubkey`.
4. **Configurar GitHub Secrets** en el repo (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY`: contenido completo de `xi.prod.key` (incluyendo header).
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: passphrase.
5. **Backup local** de `xi.prod.key` + passphrase en 1Password o similar. Si se
   pierde, xi se congela en la última versión firmada (escenario catastrophic).
6. **Primer release**:
   ```bash
   git tag v0.1.0
   git push --tags
   ```
   El workflow `.github/workflows/release.yml` se dispara, builda para las 3
   plataformas, y crea un release en estado `draft`. Revisar los artifacts y
   publicar manualmente.
7. **Verificar end-to-end**:
   - Bajar la versión publicada, instalarla.
   - Hacer un cambio chico (ej. bumpear version en `package.json`).
   - Commit + tag `v0.1.1` + push.
   - Abrir la app v0.1.0 — el banner debería aparecer con "v0.1.1 lista".
   - Click en "Reiniciar" → la app se reabre en v0.1.1.

### Pendientes chicos de la Etapa 7 (no bloquean)

- **`app.getVersion()` en lugar de hardcoded "0.1.0"** — hoy la versión en
  settings está hardcoded. Usar `import { getVersion } from '@tauri-apps/api/app'`
  para leer la versión real del binario.
- **Release notes inline en sección settings** — hoy solo se muestra el status
  ("v0.2.0 lista para aplicar"). Mostrar las primeras líneas del `body` (que
  es markdown) con un expandible para ver todo.
- **Cross-compile del sidecar pi a Windows** — el workflow tiene
  `continue-on-error: true` en `build-pi.sh` y `build-pi-sessions.sh` porque
  cross-compilar bun a Windows desde linux/macOS no funciona bien. Hoy
  distribuimos linux + macOS; Windows necesita un runner de windows
  (probablemente con `bun build --compile --target=bun-windows-x64`).
- **macOS codesign + notarization** — los builds de macOS van sin firmar,
  el user ve un warning de "developer cannot be verified" la primera vez.
  Necesita Apple Developer ID ($99/año) y configurar `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD` en GitHub Secrets. Aceptable para v1 si distribuimos
  por fuera de la App Store; bloqueante si queremos Mac App Store.

---

## Approve/Deny UI — interacción con extensiones de pi

**Contexto:** pi extensions pueden llamar `ctx.ui.confirm()`, `ctx.ui.select()`,
etc. En modo RPC, estos métodos emiten `extension_ui_request` por stdout
y esperan `extension_ui_response` por stdin. Sin interceptar esto, las
acciones `ask` de pi-tool-guard no funcionan en xi (timeout de 5s → deny
silencioso).

**Qué se necesita:**
- Backend: handler que lee `extension_ui_request` del JSONL stream
- Backend: command Tauri para enviar `extension_ui_response` por stdin
- Frontend: modal/dialog que muestra la pregunta y botones approve/deny
- Frontend: manejo de timeout (la extensión puede tener un timeout)

**Protocolo (documentado en pi extensions.md):**
```json
// stdout → xi
{ "type": "extension_ui_request", "id": "uuid",
  "method": "confirm", "title": "...", "message": "...",
  "timeout": 5000 }

// stdin ← xi
{ "type": "extension_ui_response", "id": "uuid",
  "confirmed": true }
```

**Decisión:** diseñar ANTES de pi-tool-guard. Es fundacional — sin esto,
`ask` no funciona. Crear idea en `.develop/01-idea/` y seguir el pipeline.

---

## Bundled extensions — pi-tool-guard y más

**Contexto:** xi debería venir con extensiones de pi pre-instaladas que
mejoren la experiencia del usuario no-técnico. La primera es `pi-tool-guard`
(permissions: bloquea/pide confirmación para comandos peligrosos).

**Approach decidido:**
1. Escribir `pi-tool-guard` standalone (para probar en pi TUI primero)
2. Bundlear con xi (`build-pi.sh` + `ensure_extensions`)
3. Sección "Extensiones" dentro de Settings para gestionar config

**Archivos clave:**
- `backend/extensions/pi-tool-guard/index.ts` — la extensión
- `~/.pi/agent/pi-tool-guard.json` — config de reglas
- `~/.pi/agent/extensions/pi-tool-guard/` — copia instalada

**Pendiente:** diseñar después de approve/deny UI. La idea ya existe en
`.develop/01-idea/bundled-extensions.md`.

## Investigación pendiente

- **pi TUI extension loading**: ¿cómo carga pi las extensions? ¿Auto-discovery
  de `~/.pi/agent/extensions/`? ¿Flags `-e`? ¿Settings.json?
  → Ya respondido: auto-discovery + `-e` flag + settings.json `extensions: []`
- **Conflict detection**: ¿qué pasa si hay 2 extensions con el mismo tool name?
  → Ya respondido: pi detecta conflicts, loguea diagnostics, no falla.
  Primera en cargar "gana" para tools conflictivos.
- **Bundlear extensions con xi**: ¿cómo?
  → Ya respondido: copiar a `~/.pi/agent/extensions/` si no existen.
  `build-pi.sh` copia a `backend/binaries/extensions/`.
  `ensure_extensions` command en Rust copia al arranque.

---

## Rewrite de ask tool — minimalista

**Contexto:** el `ask` actual (`~/.pi/agent/extensions/ask-tool/`) usa
`ctx.ui.custom()` que es TUI-only (retorna `undefined` en RPC). Tiene
~1000 líneas de UI custom (inline editing, tabs, cursor handling).

**Decisión:** rewrite con APIs simples (`ctx.ui.select()`, `ctx.ui.input()`).
~100-200 líneas. Funciona en TUI y RPC. Notas via "Other" option.

**Flujo por pregunta:**
1. `ctx.ui.select("pregunta", ["Opción A", "Opción B", "Other"])` → usuario elige
2. Si eligió "Other": `ctx.ui.input("Tu respuesta")` → usuario escribe
3. Si eligió otra cosa: se acepta sin nota (el "Other" cubre notas)

**Orden de implementación:**
1. Rewrito de ask (standalone, para probar en pi TUI)
2. Approve/deny UI en xi (interceptar `extension_ui_request`)
3. Bundlear ask con xi

**Archivos del ask actual:**
- `index.ts` — registro de tool, lógica de resultado (~200 LOC)
- `ask-logic.ts` — lógica pura de selección (~80 LOC)
- `ask-inline-ui.ts` — UI custom single question (~250 LOC)
- `ask-tabs-ui.ts` — UI custom multi-question tabs (~570 LOC)
- `ask-inline-editor-cursor.ts` — cursor handling (~30 LOC)
- `ask-inline-note.ts` — inline note rendering (~80 LOC)
- `ask-text-wrap.ts` — text wrapping (~50 LOC)

---

## Otros pendientes
- (vacío — agregar aquí cuando surjan)
