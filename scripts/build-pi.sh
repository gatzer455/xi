#!/bin/bash
# build-pi.sh — Compilar pi como binario standalone con bun
#
# Uso: ./scripts/build-pi.sh
#
# Requiere: bun instalado (curl -fsSL https://bun.sh/install | bash)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"
BINARIES_DIR="$BACKEND_DIR/binaries"
BUILD_DIR="/tmp/pi-build-$$"

# Detectar target triple
TARGET_TRIPLE=$(rustc --print host-tuple)
echo "Target: $TARGET_TRIPLE"

# Crear directorio temporal
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Crear package.json y entry point
cat > package.json << 'EOF'
{
  "name": "pi-standalone",
  "version": "0.79.3"
}
EOF

npm install @earendil-works/pi-coding-agent@latest 2>&1 | tail -5

cat > pi-entry.js << 'ENTRY'
require('./node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
ENTRY

# Compilar con bun
echo "Compilando pi con bun..."
bun build pi-entry.js --compile --outfile pi 2>&1

# Copiar al directorio de binaries
mkdir -p "$BINARIES_DIR"
cp pi "$BINARIES_DIR/pi-$TARGET_TRIPLE"
chmod +x "$BINARIES_DIR/pi-$TARGET_TRIPLE"

echo ""
echo "✅ pi compilado y copiado a:"
echo "   $BINARIES_DIR/pi-$TARGET_TRIPLE"
ls -lh "$BINARIES_DIR/pi-$TARGET_TRIPLE"

# Limpiar
rm -rf "$BUILD_DIR"
