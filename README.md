# xi

Interfaz de escritorio para [pi](https://github.com/earendil-works/pi-coding-agent), dirigida a personas sin conocimientos técnicos. Tauri 2 + Vanilla TypeScript + pi como motor de procesamiento de lenguaje natural.

xi resuelve un problema concreto: pi funciona desde la terminal, lo cual excluye a usuarios que no conocen ese entorno. Esta aplicación abre una ventana nativa donde cualquier persona puede conversar con pi, gestionar sesiones, configurar proveedores de inteligencia artificial y explorar archivos de su proyecto.

La aplicación es opinionada: viene con las configuraciones por defecto del desarrollador de xi. Esto significa que la aplicacion ya viene con una configuración especifica, que sin embargo es cambiable si uno ya entiende pi. Si el usuario quiere cambiar algo, puede hacerlo desde la pantalla de ajustes, pero no es obligatorio.

---

## Requisitos previos

Antes de instalar xi, necesitás:

- **Node.js** v18 o superior (recomendado: v22)
- **Rust** 1.77.2 o superior (recomendado: estable actual)
- **npm**, **pnpm** o **yarn**
- **Linux**: las librerías de sistema que Tauri necesita (ver [docs/dev.md](docs/dev.md))

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/earendil-works/xi.git
cd xi
```

### 2. Instalar dependencias del frontend

```bash
cd frontend
npm install
```

### 3. Instalar Tauri CLI

```bash
cd ..
npm install -D @tauri-apps/cli
```

### 4. Verificar que todo compila

```bash
cd frontend && npx vite build
cd ../backend && cargo check
```

### 5. Ejecutar en modo desarrollo

```bash
cd ..
npm run dev
```

La primera vez, Rust descarga y compila las dependencias. Esto tarda entre 3 y 8 minutos. Las veces siguientes, la compilación toma unos segundos.

---

## Estructura del proyecto

```
xi/
├── frontend/          ← Interfaz de usuario (TypeScript + Vite)
│   └── src/
│       ├── lib/       ← Signal, state, routing, markdown
│       ├── components/← Componentes UI
│       ├── pages/     ← Chat, sesiones, ajustes, bienvenida, explorador
│       └── styles/    ← Tokens CSS, temml
│
├── backend/           ← Núcleo Tauri (Rust)
│   └── src/commands/  ← Comandos IPC
│
├── docs/              ← Documentación del proyecto
│   ├── plan.md        ← Plan de desarrollo
│   ├── dev.md         ← Setup para developers
│   └── discoveries.md ← Decisiones técnicas
│
└── .develop/          ← Pipeline de diseño
    ├── 01-idea/
    ├── 02-design/
    └── 03-reqs/
```

---

## Stack tecnológico

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Desktop | Tauri 2 | Shell nativo, IPC, ventana |
| Backend | Rust | Lógica de negocio, filesystem |
| Frontend | TypeScript + Vite | Interfaz de usuario |
| Motor | pi (sidecar) | Procesamiento de lenguaje natural |
| Markdown | markdown-it + temml | Renderizado con soporte matemático |
| State | Signals propias (~25 LOC) | Reactividad sin dependencias |

**Dependencias de runtime en frontend:** ninguna. Todo el código es propio.

---

## Funcionalidades

- **Chat con pi**: conversación en tiempo real con streaming de tokens
- **Gestión de sesiones**: crear, listar, renombrar y eliminar sesiones
- **Configuración**: modelo, nivel de razonamiento, tema, tamaño de fuente
- **Proveedores**: configuración de API keys para 7 proveedores
- **Explorador de archivos**: navegar y editar archivos del proyecto
- **Soporte matemático**: renderizado de LaTeX con MathML
- **Auto-update**: actualizaciones con firma criptográfica

---

## Testing

```bash
# Frontend (vitest)
cd frontend
npm test            # modo watch
npm run test:run    # ejecución única

# Backend (cargo)
cd backend
cargo test
```

---

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [docs/dev.md](docs/dev.md) | Setup de desarrollo, dependencias del sistema |
| [docs/plan.md](docs/plan.md) | Plan de desarrollo, decisiones técnicas |
| [docs/discoveries.md](docs/discoveries.md) | Descubrimientos durante el desarrollo |

---

## Licencia

Por definir.
