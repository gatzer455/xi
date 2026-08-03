# Changelog

Todos los cambios notables de xi se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto adherisce a [Semantic Versioning](https://semver.org/lang/es/).

---

## [0.5.0] - 2026-08-03

Lenguaje visual shadcn + explorador estilo PND.

### Added

- **Explorador estilo PND**: navegación por directorios (un directorio por vez)
  en vez de árbol inline. Breadcrumb superior, lista con nombre · tamaño ·
  modificación, grilla con icono + nombre, toggle lista/grilla persistido en
  `localStorage`.
- **Visor/editor de archivos**: vista previa y modo fuente con edición y
  guardado, documento responsive (ancho máximo 1400px), editor a pantalla
  completa.
- **Atajos de teclado en el explorador**: `j/k/h/l`, flechas, `Enter` abre,
  `Backspace` sube, `q`/`Escape` cierra el visor y devuelve el foco al
  navegador.

### Changed

- **Lenguaje visual shadcn** (CSS-only, sin dependencias): tokens de radius,
  espacio, superficie y card sobre la paleta navy/lavender de xi.
- **Ajustes**: más aire en los controles (secciones, keyrows, extensiones).
- **Inputs con contraste reforzado**: superficie un tono más oscura, borde
  visible y anillo de foco (`--color-input-bg/border/ring`).
- **Terminal**: tamaño efectivo 14px (escala con el ajuste global de fuente),
  paleta clara rebalanceada (fondo más luminoso, ANSI oscurecido).

---

## [0.1.2] - 2026-06-25

Bugfixes y quality gates. Pi ahora arranca correctamente al crear sesiones
nuevas, los sidecars se resuelven en Windows, y no se puede mergear código
con errores de type-check.

### Added

- **Quality gates**: `tsc --noEmit` antes de `vite` en `npm run dev`, tests de
  página (WelcomePage + ChatPage con mocks), type-check en CI
- **ensure-sidecars.js**: versión Node.js cross-platform del script de build
  automático de sidecars (reemplaza el .sh que requería bash)
- **Tipo AppState exportado**: `mocks/state.ts` verificado con `satisfies`
- **Error signal por instancia**: cada mount de WelcomePage tiene su propio
  estado de error, no persiste entre montajes
- **Soporte arm64 en ensure-sidecars**: detecta `uname -m` para el triple Rust
  correcto

### Changed

- **Flujo de sesión nueva**: `startPi(cwd)` ahora se llama antes de
  `newPiSession()` (fix crítico: sin esto, mandaba `new_session` a un pi que
  no estaba corriendo)
- **Auth banner**: `renderAuthBanner(scope)` reemplaza a
  `renderWelcomeHeader()` (que nunca estuvo definida)
- **Escape key listener en dialogs**: se limpia al cerrar el dialog, no solo
  al hacer dispose de la página
- **Dev startup**: `npm run dev` ahora usa `node ensure-sidecars.js` en vez
  de `bash ensure-sidecars.sh` (funciona en Windows sin bash)

### Fixed

- **Pi no arrancaba al crear sesión nueva** (#3)
- **pi-sessions no se encontraba en Windows**: falta de extensión .exe en
  build.rs y pi_sessions.rs
- **TypeScript errors**: `renderWelcomeHeader` undefined, `title` no existe en
  `ExtensionUINotifyRequest`
- **E2E flaky en CI**: `wdio:enforceWebDriverClassic` para evitar BiDi,
  `WEBKIT_DISABLE_DMABUF_RENDERER` para software rendering,
  `waitForExist` en vez de `isExisting()`
- **Error filtraba JSON del prompt**: `format_command_not_running_error` ya no
  incluye el payload en el mensaje de error
- **Sidecar no limpiaba child al terminar**: `self.child` se resetea en
  `CommandEvent::Terminated`
- **compactionSummary**: resolución de resumen de compresión
- **Iconos RGBA**: conversión correcta de iconos
- **i18n**: terminología neutral latinoamericana

## [0.1.1] - 2026-06-22

Primer release con CI/CD funcional y empaquetado para las tres plataformas.

### Added

- CI/CD en GitHub Actions con builds para Linux, Windows y macOS
- Release automatico al pushear tag v*
- Empaquetado para Linux (.deb), Windows (.exe, .msi) y macOS (.dmg, Intel y ARM)
- docs/features.md: catalogo de funcionalidades implementadas
- docs/roadmap.md: roadmap en formato Now/Next/Later
- docs/ci-failures.md y docs/ci-research.md: documentacion de problemas de CI

### Fixed

- externalBin de pi corregido a "binaries/pi" (Tauri 2 busca en subdirectorio)
- Build de frontend incluido antes de tests de backend (necesario para --all-targets)
- pi-sessions ahora se compila al directorio correcto (backend/binaries/)
- E2E tests: texto de bienvenida actualizado, WebKitWebDriver agregado
- Clippy: falso positivo useless_format permitido con comentario explicativo
- Release: linuxdeploy reemplazado por --bundles deb (bypass de FUSE en CI)
- Release: Windows ahora ejecuta build-pi.sh con shell bash (no PowerShell)
- Release: macOS compila para Apple Silicon e Intel por separado (ya no universal)
- build.rs: busca sidecars con extension .exe en Windows
- Firma criptografica regenerada con contrasena conocida

---

## [0.1.0] - 2026-06-21

Versión inicial de xi. Interfaz de escritorio para pi, dirigida a personas sin conocimientos técnicos.

### Added

- **Chat funcional** con streaming de tokens en tiempo real
- **Thinking blocks** colapsables para ver el razonamiento de pi
- **Tool calls** con formato visual y resultado colapsable
- **Gestión de sesiones**: crear, listar, renombrar y eliminar sesiones de pi
- **Browser-shaped tabs**: múltiples sesiones abiertas como pestañas
- **Settings completo**: modelo, nivel de razonamiento, tema (claro/oscuro/sistema), tamaño de fuente
- **Proveedor de API keys**: configuración para 7 proveedores (Anthropic, OpenAI, Google, OpenRouter, Groq, OpenCode Go, DeepSeek)
- **Onboarding guiado**: página de bienvenida con párrafo explicativo y detección automática de providers
- **Auto-update**: tauri-plugin-updater con firma criptográfica y GitHub Actions
- **Versiones**:显示 xi y pi en la sección "Acerca de"
- **Extension UI handler**: intercepta requests interactivos de extensiones de pi (select, confirm, input, editor, notify)
- **Soporte matemático**: renderizado de LaTeX con temml + Noto Sans Math
- **Explorador de archivos**: navegar y editar archivos del proyecto con breadcrumb
- **Pipeline de diseño**: carpetas .develop/ con idea → diseño → requisitos
- **Tests unitarios**: 50 tests (signal, state, files)
- **README**: documentación con Diataxis + retórica hispánica

### Changed

- **Flow de bienvenida**: ahora va a sesiones en vez de chat directamente
- **Header**: botón "+" oculto en welcome/sessions
- **Settings**: secciones de modelo y proveedor condicionales según sesión activa
- **Chat**: mensajes de usuario alineados a la derecha, asistente a la izquierda
- **CSS**: paleta de colores cálidos con fuentes Adwaita

### Fixed

- **Routing**: fix de routing a #/chat y sidebar muestra sesión activa
- **Layout**: sidebar aplastada, session-item duplicado, settings clogged
- **Session loading**: fix de carga de sesiones
- **Vite**: fix de top-level await para dev server
- **Settings**: fix de scroll horizontal, feedback de test, sync de modelo
- **Header**: fix de botón '+' en welcome/sessions
- **Explorer**: fix de paths duplicados al navegar subdirectorios
- **Icons**: conversión de iconos a formato RGBA

### Deprecated

- Ninguna (versión inicial)

### Removed

- Ninguna (versión inicial)

### Security

- Firma criptográfica de actualizaciones con claves minisign
- API keys almacenadas con permisos 600 (solo propietario)
- Atomic write para auth.json (tmp + rename + fsync)

---

## [0.1.4] - 2026-06-26

Auto-update funcional. El endpoint del updater ahora apunta a GitHub Releases.

### Fixed

- **Updater endpoint vacío**: `tauri.conf.json` tenía `endpoints: []`. Ahora
  apunta a `https://github.com/gatzer455/xi/releases/latest/download/latest.json`.
  Sin esto, el updater fallaba con "Updater does not have any endpoints set".

### Changed

- `ensure-sidecars.js` → `ensure-sidecars.mjs`: elimina warning de Node sobre
  módulo sin tipo declarado.

## [0.1.3] - 2026-06-25

Pi ahora incluye los temas necesarios para arrancar. Versión pineada.

### Changed

- **Versión de pi pineada**: `@earendil-works/pi-coding-agent` como devDependency
  en `package.json` (v0.80.2). Build scripts usan `node_modules/` local en
  vez de descargar `@latest`, eliminando dependencia de internet en el build
  y asegurando builds reproducibles.
- `build-pi.sh` y `build-pi-sessions.sh`: refactor para usar la copia local
  del paquete de pi en `node_modules/` en vez de `npm install @latest`
- `ensure-sidecars.js`: referencia corregida a `build-pi.sh` (apuntaba a
  `build-pi.js` que no existía)

### Fixed

- **Pi crasheaba al iniciar**: faltaban los archivos de tema (`theme/dark.json`,
  `theme/light.json`) en el bundle. Sin estos, pi ejecuta `getBuiltinThemes`
  antes de parsear `--no-themes` y falla con ENOENT.
  - `build-pi.sh` ahora copia los temas a `backend/binaries/theme/`
  - `tauri.conf.json` los incluye como recursos del bundle
- **Build de pi-sessions**: ahora compila directo desde el proyecto raíz donde
  `node_modules` ya está resuelto, evitando errores de resolución de módulos
  en el directorio temporal

## [0.4.0] - 2025-07-27

Rediseño visual completo + migración SolidJS + sistema de paneles.

### Added

- **Rediseño visual navy/lavender**: paleta fría (navy `#0a0632` dark / lavanda
  `#bbc4fe` light, acento púrpura). Fuente Fira Sans + Fira Mono + Fira Math.
  Logo inline con `currentColor` se adapta al tema automáticamente.
- **Sistema de paneles CSS Grid**: reemplaza tile-manager. Progresión
  determinística 1→2→3→4 paneles (#81). Scroll de chat arreglado, mensajes
  nuevos aparecen correctamente.
- **Sistema de tabs unificado**: tabs browser-style en barra superior (#77).
- **SCA en CI**: `bun audit` en cada PR, vulnerabilidades como warnings.
- **Herramientas de análisis**: `scripts/find-dead-css.mjs` y
  `scripts/find-dead-code.mjs`.
- **Branded types**: `TabId` / `SessionPath` como tipos nominales (unión, no
  string crudo). Constructores `toTabId()`/`toSessionPath()` ya existentes.

### Changed

- **Migración completa a SolidJS**: WelcomePage, ChatPage, SessionsPage,
  SettingsPage, ModelPicker — 100% SolidJS. Eliminados ~4.8K LOC vanilla.
  Tests migrados a `@solidjs/testing-library`.
- **Mobile app migrada a SolidJS**: todas las páginas reescritas (connect,
  sessions, chat, explorer, projects). ~2.3K LOC eliminados.
- **Session UI refactor**: separación de CSS en archivos por página,
  limpieza de código (#83).
- **CSS cleanup**: ~53 selectores huérfanos post-migración eliminados (#82).
  +10 adicionales post-WelcomePage.

### Fixed

- **edit.rs panic**: `generate_patch` clamped a `hunk_start_old..old_i.min(old_lines.len())`
  cuando se cerraba un hunk al final del archivo.
- **Layout WelcomePage**: recents se superponían con el header. `pages.css`
  no se importaba en `index.css`. Justificación reemplazada por flujo natural
  + scroll.
- **Mobile typecheck**: `session.id` envuelto en `toTabId()` en `openExisting()`.
- **CSS layout roto**: restaurados `.update-banner`, `.output-board`,
  `.chat-messages-container`, `.explorer-panel` y otros selectores clave
  eliminados accidentalmente.
- **quinn-proto (CVE)**: `cargo update` a 0.11.16.

### Security

- **SCA en CI**: `bun audit --json` en cada push, alertas visibles como
  warnings de GitHub Actions.
