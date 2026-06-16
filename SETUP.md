# Setup — xi

## Dependencias del sistema (Linux)

Tauri en Linux requiere las siguientes librerías de desarrollo:

### Fedora / RHEL / CentOS
```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  libsoup3-devel \
  gtk3-devel \
  javascriptcoregtk4.1-devel
```

### Ubuntu / Debian
```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libsoup-3.0-dev \
  libgtk-3-dev \
  javascriptcoregtk-4.1
```

### Arch Linux
```bash
sudo pacman -S \
  webkit2gtk-4.1 \
  libsoup3 \
  gtk3
```

## Dependencias de desarrollo

- **Node.js** v18+ (recomendado: v22)
- **Rust** 1.77.2+ (recomendado: estable actual)
- **npm** o **pnpm**

## Instalación del proyecto

```bash
# 1. Instalar dependencias del frontend
cd frontend && npm install

# 2. Instalar Tauri CLI (en el root)
cd .. && npm install -D @tauri-apps/cli

# 3. Verificar que el frontend compila
cd frontend && npx vite build

# 4. Verificar que el backend compila
cd ../backend && cargo check

# 5. Ejecutar en modo desarrollo
cd .. && npm run dev
```
