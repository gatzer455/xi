# xi

Interfaz de escritorio para [pi](https://github.com/earendil-works/pi-coding-agent), un agente de inteligencia artificial creado por Mario Zechner.

xi no es un producto independiente. Es una ventana para que personas sin experiencia técnica puedan usar pi sin tocar la terminal. Pi es el motor de lenguaje natural, la gestion de sesiones y la inteligencia artificial. Xi se encarga de mostrar una pantalla donde el usuario conversa con pi sin ver comandos ni configuraciones tecnicas.

La aplicacion viene con valores por defecto que quien desarrolla xi considera sensatos. Si el usuario quiere cambiarlos, puede hacerlo desde la pantalla de ajustes. No es obligatorio.

---

## Requisitos

- **Node.js** v18 o superior (recomendado: v22)
- **Rust** 1.77.2 o superior
- **npm** o **pnpm**
- **Linux**: las librerias de sistema que Tauri necesita (ver [docs/dev.md](docs/dev.md))

---

## Instalacion

```bash
git clone https://github.com/gatzer455/xi.git
cd xi
cd frontend && npm install
cd .. && npm install -D @tauri-apps/cli
```

Para verificar que todo compila:

```bash
cd frontend && npx vite build
cd ../backend && cargo check
```

Para ejecutar en modo desarrollo:

```bash
npm run dev
```

La primera vez, Rust descarga y compila las dependencias. Tarda entre 3 y 8 minutos. Las veces siguientes, la compilacion toma segundos.

---

## Lo que ya funciona

Las funcionalidades implementadas estan documentadas en [docs/features.md](docs/features.md). Incluyen chat con streaming, gestion de sesiones, configuracion de proveedores, explorador de archivos, actualizaciones automaticas y soporte para extensiones de pi.

El plan de desarrollo, con lo que sigue, esta en [docs/roadmap.md](docs/roadmap.md).

---

## Estructura del proyecto

```
xi/
  frontend/            Interfaz de usuario (TypeScript + Vite)
    src/
      lib/             Seniales, estado, ruteo, markdown
      components/      Componentes de interfaz
      pages/           Chat, sesiones, ajustes, bienvenida, explorador
      styles/          Tokens CSS, temml
  backend/             Nucleo Tauri (Rust)
    src/commands/      Comandos IPC
  docs/                Documentacion
  .develop/            Pipeline de diseno (idea, diseno, requisitos)
```

---

## Stack

| Capa | Tecnologia |
|------|------------|
| Desktop | Tauri 2 |
| Backend | Rust |
| Frontend | TypeScript + Vite |
| Motor | pi (sidecar compilado con bun) |
| Markdown | markdown-it + temml |
| State | Seniales propias (~25 lineas) |
| Routing | Hash-based propio (~80 lineas) |

---

## Desarrollo

```bash
# Tests del frontend
cd frontend && npm test

# Tests del backend
cd backend && cargo test

# Tests E2E (requiere tauri-driver)
npm run test:e2e
```

Ver [docs/dev.md](docs/dev.md) para el setup completo de desarrollo.

---

## Licencia

MIT
