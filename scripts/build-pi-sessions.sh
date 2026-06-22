#!/usr/bin/env bash
# build-pi-sessions.sh — Compilar el binario pi-sessions con bun.
#
# Espejo de build-pi.sh. Genera un binario standalone (no requiere bun en runtime)
# que el backend de xi invoca como sub-proceso para list/delete/rename de sesiones.
#
# Uso: ./scripts/build-pi-sessions.sh [--target linux|windows|macos]
#
# Requiere: bun y npm instalados. Pi (npm package) se instala en un temp dir.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC="$PROJECT_ROOT/backend/scripts/pi-sessions.ts"
OUT_DIR="$PROJECT_ROOT/backend/binaries"

# ─── Parsear argumentos ───────────────────────────────────────────────────────
TARGET=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      TARGET="$2"
      shift 2
      ;;
    *)
      echo "Uso: $0 [--target linux|windows|macos]"
      exit 1
      ;;
  esac
done

# ─── Detectar platform si no se especifica ────────────────────────────────────
if [[ -z "$TARGET" ]]; then
  OS=$(uname -s)
  case $OS in
    Linux)  TARGET="linux" ;;
    Darwin) TARGET="macos" ;;
    *)      echo "❌ OS no soportado: $OS"; exit 1 ;;
  esac
fi

# ─── Mapear target a bun --target y Rust target triple ────────────────────────
case $TARGET in
  linux)
    BUN_TARGET="bun-linux-x64"
    RUST_TRIPLE="x86_64-unknown-linux-gnu"
    BINARY_SUFFIX=""
    ;;
  windows)
    BUN_TARGET="bun-windows-x64"
    RUST_TRIPLE="x86_64-pc-windows-msvc"
    BINARY_SUFFIX=".exe"
    ;;
  macos)
    BUN_TARGET="bun-darwin-arm64"
    RUST_TRIPLE="aarch64-apple-darwin"
    BINARY_SUFFIX=""
    ;;
  macos)
    BUN_TARGET="bun-darwin-arm64"
    RUST_TRIPLE="aarch64-apple-darwin"
    BINARY_SUFFIX=""
    ;;
  macos-intel)
    BUN_TARGET="bun-darwin-x64"
    RUST_TRIPLE="x86_64-apple-darwin"
    BINARY_SUFFIX=""
    ;;
  *)
    echo "❌ Target no soportado: $TARGET (usa: linux, windows, macos, macos-intel)"
    exit 1
    ;;
esac

OUT="$OUT_DIR/pi-sessions-$RUST_TRIPLE$BINARY_SUFFIX"

echo "Target: $TARGET"
echo "Bun target: $BUN_TARGET"
echo "Rust triple: $RUST_TRIPLE"

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

echo "Compilando pi-sessions con bun (target: $BUN_TARGET)..."
bun build "$ENTRY" \
	--compile \
	--target="$BUN_TARGET" \
	--outfile "$OUT" 2>&1

chmod +x "$OUT"

# Limpiar
cd "$PROJECT_ROOT"
rm -rf "$BUILD_DIR"

echo ""
echo "✅ pi-sessions compilado:"
ls -lh "$OUT"
