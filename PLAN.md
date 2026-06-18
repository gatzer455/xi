# Plan de desarrollo — xi

Interfaz de escritorio para pi, dirigida a usuarios no-técnicos. Tauri + Vanilla TypeScript + pi como motor via RPC.

---

## Premisas de diseño

| Premisa | Detalle |
|---------|---------|
| **Motor** | pi via `--mode rpc` (JSONL sobre stdin/stdout) |
| **Framework desktop** | Tauri 2 (Rust core, WebView nativo) |
| **Frontend** | Vanilla TypeScript + Vite, patrón de 4 capas de musicologo |
| **Actualización de pi** | Sidecar binario, actualizable independientemente de la app |
| **Actualización de la app** | `tauri-plugin-updater` (firma criptográfica, auto-restart) |
| **Mantenimiento mínimo** | 0 dependencias de runtime en frontend, protocolo RPC estable |

---

## Arquitectura

```
xi/
├── package.json              ← Root: scripts de conveniencia
├── frontend/                 ← UI (Vanilla TS + Vite)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── fonts/
│   ├── public/
│   └── src/
│       ├── main.ts           ← Entry point, registra rutas
│       ├── router.ts         ← Capa 3: hash-based routing
│       ├── lib/
│       │   ├── signal.ts     ← Capa 2: reactividad (25 líneas)
│       │   ├── state.ts      ← Capa 4: estado global
│       │   ├── pi-rpc.ts     ← Comunicación con pi via Tauri IPC
│       │   └── markdown.ts   ← Renderizado de markdown del asistente
│       ├── components/       ← Capa 1: funciones → HTMLElement
│       │   ├── chat-bubble.ts
│       │   ├── chat-input.ts
│       │   ├── sidebar.ts
│       │   ├── tool-call.ts
│       │   └── thinking-block.ts
│       ├── pages/
│       │   ├── chat.ts       ← Página principal (conversación)
│       │   ├── sessions.ts   ← Lista de sesiones
│       │   ├── settings.ts   ← Configuración (modelo, auth)
│       │   └── welcome.ts    ← Onboarding / primera vez
│       └── styles/
│           └── tokens.css    ← Design tokens + reset
│
├── backend/                  ← Tauri core (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/
│   │   └── default.json
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   └── commands/
│   │       ├── pi_process.rs   ← Gestión del sidecar pi
│   │       ├── pi_rpc.rs       ← Bridge stdin/stdout ↔ frontend
│   │       └── updater.rs      ← Comando de auto-update
│   ├── icons/
│   ├── pi-x86_64-unknown-linux-gnu    ← Sidecar pi (copiado a target/debug por build.rs)
│   ├── pi-x86_64-pc-windows-msvc.exe
│   ├── pi-aarch64-apple-darwin
│   ├── theme/                          ← Recursos de pi (copiados a target/debug por build.rs)
│   │   ├── dark.json
│   │   └── light.json
│   └── build.rs                        ← Hook: copia sidecar + theme/ a target/debug/
│
└── shared/                   ← Tipos compartidos (si hace falta)
    └── rpc-types.ts
```

---

## Stack tecnológico

### Frontend

| Capa | Tecnología | Mantenimiento |
|------|-----------|---------------|
| Build | Vite 8+ | Solo devDependency |
| Lenguaje | TypeScript 5+ | Solo devDependency |
| Routing | Hash-based propio (~80 LOC) | Cero |
| Reactividad | Signal<T> propio (~25 LOC) | Cero |
| State | Signals globales (~50 LOC) | Cero |
| Markdown | marked (única dependencia runtime) | Actualizar cuando salga major |
| CSS | Custom properties + tokens | Cero |

**Dependencias de runtime:** 1 sola (`marked` para renderizar markdown del asistente).

### Backend (Tauri / Rust)

| Componente | Detalle |
|-----------|---------|
| Tauri 2 | Desktop shell, IPC, window management |
| `tauri-plugin-shell` | Para ejecutar el sidecar pi |
| `tauri-plugin-updater` | Auto-update de la app |
| Sidecar: `pi --mode rpc` | Binario de pi empaquetado |

### Comunicación

```
┌─────────────────────────────────────────────────┐
│  Frontend (WebView)                             │
│                                                 │
│  usuario escribe ──→ invoke("send_prompt", msg) │
│                                                 │
│  event "pi:event" ←── streaming tokens          │
│  event "pi:event" ←── tool calls                │
│  event "pi:event" ←── thinking blocks           │
└────────────────────┬────────────────────────────┘
                     │ Tauri IPC (invoke / event)
┌────────────────────▼────────────────────────────┐
│  Tauri Core (Rust)                              │
│                                                 │
│  pi_process.rs:                                 │
│    - spawn("pi", ["--mode", "rpc"])             │
│    - stdin.write(jsonl)                         │
│    - stdout.read_line() → emit("pi:event", msg) │
│                                                 │
│  pi_rpc.rs:                                     │
│    - Command::sidecar("binaries/pi")            │
│    - lifecycle management (start/stop/restart)  │
└────────────────────┬────────────────────────────┘
                     │ stdin/stdout (JSONL)
┌────────────────────▼────────────────────────────┐
│  pi --mode rpc (sidecar)                        │
│                                                 │
│  {"type":"prompt","message":"Hola"}      →      │
│  ← {"type":"message_update",...,"text_delta"}   │
│  ← {"type":"tool_execution_start",...}          │
│  ← {"type":"tool_execution_end",...}            │
│  ← {"type":"agent_end",...}                     │
└─────────────────────────────────────────────────┘
```

---

## Etapas de desarrollo y validación

### Etapa 0: Fundamentos del proyecto
**Objetivo:** Estructura de carpetas, configs, y primer build vacío.

**Estado:** ✅ Completada

**Tareas:**
1. ✅ Crear estructura de carpetas (`frontend/`, `backend/`, `shared/`)
2. ✅ Inicializar `package.json` root con scripts de conveniencia
3. ✅ Inicializar frontend con Vite + TypeScript vanilla
4. ✅ Inicializar backend con `cargo init` + Tauri 2
5. ✅ Configurar `tauri.conf.json` con paths correctos
6. ✅ Configurar `vite.config.ts`
7. ✅ Verificar que `npm run dev` abre una ventana vacía

**Validación:**
- [x] Estructura de carpetas creada
- [x] `vite build` genera `dist/` correctamente
- [x] `tauri.conf.json` apunta a `../frontend/dist` (relativo a `backend/`)
- [x] `cargo check` compila sin errores
- [x] `npm run dev` abre ventana con "xi" y "Interfaz de escritorio para pi"
- [x] Fondo oscuro se aplica (tokens CSS cargan)

---

### Etapa 1: Patrón de 4 capas (frontend puro)
**Objetivo:** Replicar la arquitectura de musicologo adaptada a xi.

**Estado:** ✅ Completada

**Tareas:**
1. ✅ Implementar `signal.ts` (copiado de musicologo)
2. ✅ Implementar `state.ts` con signals para xi
3. ✅ Implementar `router.ts` (hash-based)
4. ✅ Implementar `tokens.css` con design tokens propios de xi
5. ✅ Crear página `chat.ts` con welcome state + input
6. ✅ Crear componentes: `sidebar.ts`, `chat-bubble.ts`, `chat-input.ts`
7. ✅ Verificar routing entre páginas

**Validación:**
- [x] `navigate('#/chat')` renderiza la página de chat
- [x] `navigate('#/settings')` renderiza la página de settings
- [x] Las signals notifican a suscriptores al cambiar
- [x] `tsc --noEmit` compila sin errores
- [x] `vite build` genera `dist/` correctamente
- [x] Sidebar se renderiza con logo, sessions, y botón de settings
- [x] Input de chat con Enter para enviar, Shift+Enter para newline
- [x] Mensajes se agregan al estado y se renderizan como burbujas

---

### Etapa 2: Sidecar pi (conexión Rust ↔ pi)
**Objetivo:** El proceso Rust puede spawnear pi y comunicarse via JSONL.

**Estado:** ✅ Completada

**Tareas:**
1. ✅ Compilar pi como binario standalone con `bun build --compile`
2. ✅ Colocar en `backend/pi-{target-triple}` (raíz, no en `binaries/`)
3. ✅ Configurar `externalBin: ["pi"]` en `tauri.conf.json` (sin prefijo `binaries/`)
4. ✅ Implementar `pi_process.rs`:
   - Spawn via `tauri_plugin_shell::ShellExt::sidecar("pi")`
   - Gestión de stdin/stdout via async events
   - Emite eventos al frontend via `app.emit("pi:raw", ...)`
5. ✅ Implementar `pi_rpc.rs` con comandos Tauri:
   - `start_pi`, `stop_pi`, `send_prompt`, `abort_pi`
   - `get_pi_state`, `get_pi_messages`, `new_pi_session`
6. ✅ Script `scripts/build-pi.sh` para compilar pi
7. ✅ Registrar comandos en `main.rs`
8. ✅ `build.rs` que copia el sidecar + `theme/` a `target/debug/` automáticamente
9. ✅ Shippear `theme/dark.json` y `theme/light.json` (pi los carga al lado del binario)

**Validación:**
- [x] `cargo check` compila sin errores
- [x] Binario de pi (101MB) embebido en `backend/`
- [x] `externalBin: ["pi"]` configurado (resuelve a `target/debug/pi`)
- [x] Capabilities configurados para `shell:allow-execute` con `name: "pi", sidecar: true`
- [x] `npm run dev` spawnea pi correctamente (validado en sesión)
- [x] `theme/dark.json` y `theme/light.json` se copian a `target/debug/theme/`
- [x] pi arranca, carga extensión pi-claude, y queda listo para RPC

---

### Etapa 3: Chat funcional (frontend ↔ pi)
**Objetivo:** El usuario puede abrir una carpeta, escribir mensajes y ver respuestas de pi.

**Estado:** ✅ Completada

**Tareas:**
1. ✅ Implementar `pi-rpc.ts` (frontend):
   - `sendPrompt(message)` → `invoke("send_prompt", { message })`
   - `startPi(cwd)` → `invoke("start_pi", { cwd })`
   - `listen("pi:raw", handler)` → parsing de eventos JSONL
   - `message_update` → `text_delta` → append a signal
2. ✅ Actualizar sidebar:
   - Mostrar carpeta de trabajo actual
   - Botón "Abrir carpeta" → diálogo nativo con `@tauri-apps/plugin-dialog`
   - Al seleccionar carpeta → reinicia pi con ese cwd
3. ✅ Implementar `chat-input.ts`:
   - Textarea auto-expandible
   - Enter para enviar, Shift+Enter para newline
   - Estado disabled durante streaming
4. ✅ Implementar `chat-bubble.ts`:
   - Burbuja de usuario (texto plano)
   - Burbuja de asistente con tool calls colapsables
   - Indicador de streaming (cursor parpadeante)
5. ✅ Implementar `chat.ts`:
   - Lista de mensajes con scroll automático
   - Welcome state según si hay carpeta seleccionada
6. ✅ Wire everything: input → pi-rpc → state → bubble
7. ✅ Plugin `tauri-plugin-dialog` para selector de carpetas

**Validación:**
- [x] TypeScript compila sin errores
- [x] Rust compila sin errores
- [x] `pi-rpc.ts` conecta con el sidecar via Tauri IPC
- [x] Sidebar muestra carpeta de trabajo y botón de abrir
- [x] Chat input envía mensajes a pi
- [x] Escribir "Hola ainwater" y presionar Enter envía el prompt a pi (validado en sesión)
- [x] La respuesta aparece token por token en la burbuja del asistente (validado en sesión)
- [x] Thinking blocks se reciben y se procesan
- [x] Turn end / agent end cierran la conversación limpiamente

---

### Etapa 4: Gestión de sesiones ✅
**Objetivo:** El usuario puede crear, listar y resumir sesiones.

**Implementación (completada):**

| Pieza | Detalle |
|-------|---------|
| **`pi-sessions` binario** | Sidecar hermano de pi (101MB), compilado con `bun build --compile` desde `backend/scripts/pi-sessions.ts`. Importa `SessionManager` y `SettingsManager` de `@earendil-works/pi-coding-agent` |
| **3 operaciones CLI** | `list <cwd>`, `delete <session-path>`, `rename <session-path> <name>` |
| **3 Tauri commands** | `list_sessions`, `delete_session`, `rename_session` en `backend/src/commands/pi_sessions.rs` |
| **Frontend bridge** | `lib/pi/tauri-commands.ts` envuelve los 3 commands con logging |
| **Página `#/sessions`** | `frontend/src/pages/sessions.ts` (447 líneas): header, error banner, lista con polling 10s (pausa en tab oculta), footer, items con switch/rename inline/delete con doble confirm en activa |
| **Sidebar** | Botón "Ver todas" en `components/sidebar.ts` → `navigate('#/sessions')` |
| **Tokens CSS** | `+250 líneas` en `styles/tokens.css` para la página de sesiones |
| **`switch_session`** | `pi_process.rs` y `pi_rpc.rs` extendidos con `session_path: Option<String>`; valida `fs::metadata` antes de matar el sidecar |
| **`build.rs`** | `copy_pi_sessions` + `cargo:rerun-if-changed=scripts/pi-sessions.ts` |
| **Capabilities** | `pi-sessions` agregado al `allowlist` con `sidecar: true` |
| **Pipeline `.develop/`** | `01-idea`, `02-design`, `03-reqs` (~63KB total) |

**Fix crítico durante implementación (importante):**

`pi-sessions` inicialmente usaba el `process.cwd()` del binario para descubrir el `sessionDir`, lo que **siempre caía en el default global** `~/.pi/agent/sessions/<encoded>/` porque el binario se ejecuta desde `target/debug/`. Resultado: xi listaba 0 sesiones, mientras que pi TUI listaba las del proyecto desde `<cwd>/.pi/sessions/`.

**Solución (principio: "xi hace lo mismo que hace pi en la TUI"):**

```ts
// En pi-sessions.ts — replica lo que hace agent-session-runtime.js:150
function resolveSessionDir(cwd: string): string {
  const sm = SettingsManager.create(cwd);          // lee <cwd>/.pi/settings.json + ~/.pi/agent/settings.json
  const raw = sm.getSessionDir();                  // ".pi/sessions" o undefined
  if (!raw) return getDefaultSessionDir(cwd);      // ~/.pi/agent/sessions/<encoded>/
  if (!isAbsolute(raw)) return resolve(cwd, raw);  // relativo → absoluto
  return raw;
}
```

Verificado empíricamente: 3 sesiones del proyecto xi se listan correctamente con `SessionManager.list(cwd, resolvedDir)`.

**Conocidos (no críticos para v1):**
- Después de delete desde xi, la TUI de pi no se refresca automáticamente (necesita watcher de FS o F5 manual)
- Switch a sesión inactiva no carga mensajes históricos en la UI (sólo resetea el chat activo; el historial requeriría un comando `get_state` post-switch)

**Validación E2E (verificada):**
- [x] La lista de sesiones muestra sesiones anteriores (3 sesiones del proyecto xi)
- [x] Click en una sesión la restaura con su historial (switch mata sidecar + restart con `--session <path>`)
- [x] Rename agrega entry `session_info` compatible con `appendSessionInfo` de pi
- [x] Delete unlinkea el JSONL
- [x] Polling 10s detecta cambios externos
- [x] Doble confirm en delete de sesión activa

---

### Etapa 5: Tool calls y thinking blocks
**Objetivo:** Mostrar herramientas que pi usa y su razonamiento.

**Tareas:**
1. Implementar `tool-call.ts`:
   - Nombre de la herramienta + argumentos colapsables
   - Estado: ejecutando / completado / error
   - Resultado colapsable
2. Implementar `thinking-block.ts`:
   - Bloque colapsable "Pensando..."
   - Toggle para expandir/contraer
3. Actualizar `chat-bubble.ts` para renderizar:
   - `text_delta` → texto
   - `toolcall_start/delta/end` → tool call
   - `thinking_start/delta/end` → thinking block
4. Implementar permisos de herramientas:
   - Antes de ejecutar una herramienta peligrosa, preguntar al usuario
   - UI de confirmación (approve / deny)

**Validación:**
- [ ] Cuando pi usa `bash`, se muestra el comando y su output
- [ ] Cuando pi usa `read`, se muestra qué archivo leyó
- [ ] Los thinking blocks son colapsables por defecto
- [ ] El usuario puede aprobar/denegar herramientas peligrosas

---

### Etapa 6: Settings y configuración
**Objetivo:** El usuario puede configurar modelo, proveedor y apariencia.

**Tareas:**
1. Implementar `settings.ts` (página):
   - Selector de modelo (lista de disponibles via `get_available_models`)
   - Selector de thinking level
   - Tema (claro/oscuro/sistema)
   - Tamaño de fuente
2. Implementar comandos RPC en `pi_rpc.rs`:
   - `set_model` → `{"type":"set_model","provider":"...","modelId":"..."}`
   - `set_thinking_level` → `{"type":"set_thinking_level","level":"..."}`
   - `get_available_models` → `{"type":"get_available_models"}`
3. Persistir settings en localStorage
4. Aplicar settings al iniciar la app

**Validación:**
- [x] Cambiar de modelo funciona (la siguiente respuesta usa el nuevo modelo)
- [x] Cambiar thinking level funciona
- [x] El tema se aplica correctamente
- [x] Los settings persisten entre reinicios

**Implementación (84d81c5 → siguiente commit):**
- Persistencia híbrida: modelo/thinking via RPC de pi (escribe a `<cwd>/.pi/settings.json` / `~/.pi/agent/settings.json`); tema/font via localStorage (`xi.theme` / `xi.fontSize`).
- `data-theme` en `<html>` con override de tokens CSS: `:root:not([data-theme])` en el media query + selectores explícitos `[data-theme='dark'|'light']` que ganan sobre el OS.
- `--font-size-base` con `data-font-size` en `<html>`, text-* en `em` para reescalar proporcionalmente.
- 5 secciones en `pages/settings.ts`: Modelo, Razonamiento, Apariencia, Sesión, Acerca de.
- Dropdown de modelo con 4 estados: cargando, error, vacío (sin providers), listo.
- `get_available_models` se maneja en `state-sync.ts` (no en el wrapper — la respuesta llega via eventos).
- Type guards en `lib/settings-storage.ts` (Parse, don't validate).
- `ThinkingLevel` como string union discriminado.

---

### Etapa 7: Auto-update de la app
**Objetivo:** La app se actualiza sola sin intervención del usuario.

**Tareas:**
1. Instalar `tauri-plugin-updater`
2. Configurar `tauri.conf.json`:
   - `bundle.createUpdaterArtifacts: true`
   - `plugins.updater.pubkey`
   - `plugins.updater.endpoints`
3. Generar par de claves para firma
4. Implementar `updater.rs`:
   - `check_for_updates()` → devuelve si hay update disponible
   - `download_and_install()` → descarga, verifica firma, instala
5. Implementar UI de update:
   - Banner "Actualización disponible" con changelog
   - Botón "Actualizar ahora" → download + restart
   - Barra de progreso durante descarga
6. Configurar endpoint de updates (GitHub Releases o S3)

**Validación:**
- [x] Al iniciar, la app chequea si hay updates
- [x] Si hay update, muestra el banner con changelog
- [x] "Actualizar ahora" descarga, instala y reinicia
- [x] La firma criptográfica verifica la autenticidad del update

**Implementación (5ef087c → b9359a3):**
- Plumbing: tauri-plugin-updater v2 + tauri-plugin-process v2 (Cargo.toml + package.json + main.rs + capabilities).
- Config: pubkey dev embebida en tauri.conf.json, endpoints: [] (a llenar cuando exista repo), createUpdaterArtifacts: true, installMode: 'passive' para Windows.
- Frontend: `lib/updater.ts` con checkForUpdate (tryCheck extraído para evitar try anidado), installAndRelaunch, dismissBanner, isUpdaterAvailable. State machine de 5 estados con assertNever.
- UI: banner en top-bar (visibility:hidden reservado) + sección "Actualización" en settings con status mapeado por switch exhaustivo.
- Auto-check con delay 2.5s en main.ts (no compite con carga de pi).
- CI/CD: `.github/workflows/release.yml` con matriz linux/Windows/macOS, tauri-action@v0, secrets documentados.
- Docs: discoveries.md §10 (custodia) y §11 (mock testing), SETUP.md (keygen).

**Pendiente (no bloquea esta etapa):**
- Llenar `endpoints` con la URL real del repo cuando exista
- Configurar GitHub Secrets en el repo
- Versión real de la app en settings (hoy hardcoded "0.1.0", futuro: app.getVersion())
- Cross-compile del sidecar pi a Windows (v1: linux + macOS)
- Body/release notes inline en sección settings (hoy solo status text)

---

### Etapa 8: Actualización de pi (sidecar)
**Objetivo:** pi se actualiza independientemente de la app.

**Tareas:**
1. Implementar comando `update_pi` en Rust:
   - Ejecuta `pi update --self` como child process
   - Captura stdout/stderr
   - Devuelve resultado al frontend
2. Implementar UI:
   - Botón "Actualizar pi" en settings
   - Indicador de versión actual de pi
   - Indicador de versión disponible (via `pi.dev/api/latest-version`)
3. Estrategia de distribución del sidecar:
   - **Opción A:** Embeber binario de pi en el installer, usuario ejecuta `pi update`
   - **Opción B:** Descargar pi en primer lanzamiento, guardarlo en app data
   - **Opción C:** Actualizar pi junto con la app (menos flexible)

**Validación:**
- [ ] La versión de pi se muestra en settings
- [ ] "Actualizar pi" ejecuta el update correctamente
- [ ] Después del update, pi funciona normalmente
- [ ] Si el update de pi falla, la app sigue funcionando con la versión anterior

---

### Etapa 9: Onboarding y UX para no-técnicos
**Objetivo:** Un usuario sin conocimientos técnicos puede usar xi sin ayuda.

**Tareas:**
1. Implementar `welcome.ts` (página de onboarding):
   - Explicación simple de qué es xi
   - Guía para configurar API key del proveedor LLM
   - Primer prompt sugerido
2. Implementar flujo de configuración de API key:
   - Detectar si ya hay credenciales (`~/.pi/agent/auth.json`)
   - Si no hay, guiar al usuario paso a paso
   - Validar que la key funciona antes de continuar
3. Implementar tooltips y ayuda contextual
4. Implementar estado vacío con sugerencias:
   - "Escribe tu primer mensaje"
   - Sugerencias de prompts (ej: "Explícame qué es un array")
5. Testing con usuarios reales no-técnicos

**Validación:**
- [ ] Un usuario nuevo puede configurar xi en < 3 minutos
- [ ] El primer prompt funciona sin errores
- [ ] Las sugerencias de prompts son útiles y variadas
- [ ] El usuario entiende qué está pasando en cada momento

---

### Etapa 10: Pulido y distribución
**Objetivo:** xi está listo para ser usado por otros.

**Tareas:**
1. Iconos de app para cada plataforma
2. Nombre de app y bundle identifier correctos
3. Testing en Windows, macOS, Linux
4. Crear installers:
   - `.dmg` para macOS
   - `.msi` / `.exe` para Windows
   - `.AppImage` / `.deb` para Linux
5. Configurar CI/CD:
   - Build automático en push a main
   - Firma de artefactos
   - Upload a endpoint de updates
6. Documentación de usuario:
   - Cómo instalar
   - Cómo configurar API key
   - FAQ

**Validación:**
- [ ] El installer pesa < 30 MB (sin el modelo de pi)
- [ ] La app arranca en < 2 segundos
- [ ] La app usa < 100 MB de RAM en reposo
- [ ] El auto-update funciona en las 3 plataformas
- [ ] Un usuario puede instalar y usar sin leer documentación

---

## Decisiones técnicas pendientes

| Decisión | Opciones | Recomendación |
|----------|----------|---------------|
| **Embebido vs descarga de pi** | Embebido en installer vs descargar en primer run | Embebido (más simple para el usuario) |
| **Markdown renderer** | `marked` vs `markdown-it` vs propio | `marked` (maduro, ligero, bien mantenido) |
| **Temas** | CSS custom properties vs CSS modules vs styled-components | CSS custom properties (como musicologo) |
| **Persistencia de sesiones** | Sessions de pi en ~/.pi vs copiar a app data | Sessions de pi en ~/.pi (pi ya las maneja) |
| **Multi-ventana** | Una ventana vs múltiples | Una ventana por ahora (simplificar) |
| **Terminal embebida** | Mostrar output de herramientas vs terminal completo | Mostrar output colapsable (más simple) |

---

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Breaking changes en RPC de pi | Media | Alto | Pinneary versión de pi, testear antes de actualizar |
| WebView inconsistente entre OS | Baja | Medio | CSS simple, testing en 3 plataformas |
| Sidecar pi demasiado grande | Baja | Bajo | pi CLI pesa ~50 MB, aceptable |
| Usuario no configura API key | Alta | Alto | Onboarding guiado, detección automática |
| pi update rompe algo | Media | Medio | Mantener versión anterior, rollback automático |

---

## Cronograma estimado

| Etapa | Duración estimada | Dependencias |
|-------|------------------|--------------|
| 0. Fundamentos | 1-2 días | Ninguna |
| 1. Patrón 4 capas | 1-2 días | Etapa 0 |
| 2. Sidecar pi | 2-3 días | Etapa 0 |
| 3. Chat funcional | 2-3 días | Etapas 1, 2 |
| 4. Sesiones | 1-2 días | Etapa 3 |
| 5. Tool calls | 2-3 días | Etapa 3 |
| 6. Settings | 1-2 días | Etapa 3 |
| 7. Auto-update app | 1-2 días | Etapa 0 |
| 8. Update pi | 1 día | Etapa 2 |
| 9. Onboarding | 2-3 días | Etapas 3, 6 |
| 10. Pulido | 3-5 días | Todas |

**Total estimado:** 15-25 días de desarrollo activo.

---

## Referencias

- [RPC de pi](../../.nvm/versions/node/v22.20.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md)
- [SDK de pi](../../.nvm/versions/node/v22.20.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)
- [Tauri Sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Tauri Updater](https://v2.tauri.app/plugin/updater/)
- [Musicologo frontend](../musicologo/frontend/) — Patrón de 4 capas
- [Pi Studio](https://github.com/shixin-guo/pi-studio) — Referencia de Tauri + pi
