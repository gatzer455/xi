# Changelog

Todos los cambios notables de xi se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto adherisce a [Semantic Versioning](https://semver.org/lang/es/).

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
