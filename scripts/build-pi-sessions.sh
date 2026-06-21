#!/usr/bin/env bash
# build-pi-sessions.sh — Compilar el binario pi-sessions con bun.
#
# Espejo de build-pi.sh. Genera un binario standalone (no requiere bun en runtime)
# que el backend de xi invoca como sub-proceso para list/delete/rename de sesiones.
#
# Uso: ./scripts/build-pi-sessions.sh
#
# Requiere: bun y npm instalados. Pi (npm package) se instala en un temp dir.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC="$PROJECT_ROOT/backend/scripts/pi-sessions.ts"
OUT_DIR="$PROJECT_ROOT/backend"

# Detectar target triple (mismo que el host donde corre xi, igual que pi).
TARGET_TRIPLE=$(rustc --print host-tuple)
OUT="$OUT_DIR/pi-sessions-$TARGET_TRIPLE"

# Build en un temp dir para no contaminar el repo con node_modules.
BUILD_DIR="/tmp/pi-sessions-build-$$"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

cat > package.json << 'EOF'
{
  "name": "pi-sessions-build",
  "version": "0.0.0",
  "private": true
}
EOF

echo "Instalando @earendil-works/pi-coding-agent..."
npm install @earendil-works/pi-coding-agent@latest >/dev/null 2>&1

# Copiamos el entry point y el helper module al BUILD_DIR para que bun resuelva
# el import `./sessions-helpers.ts` y `@earendil-works/pi-coding-agent`
# desde `node_modules/` adyacente. (Mismo truco que usa build-pi.sh con `pi-entry.js`.)
cp "$SRC" "$BUILD_DIR/pi-sessions.ts"
cp "$PROJECT_ROOT/backend/scripts/sessions-helpers.ts" "$BUILD_DIR/sessions-helpers.ts"
ENTRY="$BUILD_DIR/pi-sessions.ts"

echo "Compilando pi-sessions con bun..."
# bun detecta el target (linux/darwin) del host donde se compila. No hace
# falta pasar --target como en rustc — el target triple es solo para nombrar
# el archivo de salida (mismo que usa build-pi.sh).
bun build "$ENTRY" \
	--compile \
	--outfile "$OUT" 2>&1

chmod +x "$OUT"

# Limpiar
cd "$PROJECT_ROOT"
rm -rf "$BUILD_DIR"

echo ""
echo "✓ pi-sessions compilado:"
ls -lh "$OUT"
