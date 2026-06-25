# Changelog

Todos los cambios notables de xi se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto adherisce a [Semantic Versioning](https://semver.org/lang/es/).

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

## [Unreleased]

### Added

- CHANGELOG.md
- Reorganización de docs (plan.md, dev.md)

### Changed

- Ninguno

### Fixed

- Ninguno
