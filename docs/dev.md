# Desarrollo

Dependencias y comandos para compilar xi desde el código fuente.

## Dependencias del sistema

### Linux (Debian/Ubuntu)
```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libsoup-3.0-dev \
  libgtk-3-dev \
  javascriptcoregtk-4.1
```

### Fedora
```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  libsoup3-devel \
  gtk3-devel \
  javascriptcoregtk4.1-devel
```

### Arch
```bash
sudo pacman -S webkit2gtk-4.1 libsoup3 gtk3
```

## Dependencias de herramientas

- **Bun** 1.1+ (para frontend tooling y build de pi)
- **Rust** 1.77.2+ (para backend Tauri y paquetes Rust)
- **Tauri CLI** (se instala con bun)

## Compilar y ejecutar

```bash
# Clonar
git clone https://github.com/gatzer455/xi.git
cd xi

# Instalar dependencias (cada proyecto npm tiene su node_modules)
cd apps/desktop/frontend && bun install
cd ../..
cd packages/xi-ui && bun install
cd ../..
cd apps/mobile/frontend && bun install
cd ../..

# Build de sidecars (pi, pi-sessions, extensiones)
bun run ./scripts/ensure-sidecars.mjs

# Dev: levanta Vite + Tauri
bun run dev
```

## Tests

```bash
apps/desktop/frontend:  cd apps/desktop/frontend && bunx vitest run
apps/desktop/backend:   cd apps/desktop/backend && cargo test
apps/mobile/frontend:   cd apps/mobile/frontend && bunx vitest run
```

## Release

```bash
# 1. Bump version en package.json, Cargo.toml, tauri.conf.json
# 2. Actualizar CHANGELOG.md
# 3. git commit -m "chore: bump to vX.Y.Z"
# 4. git tag vX.Y.Z && git push origin main --tags
# 5. GitHub Actions compila y publica el release
```
