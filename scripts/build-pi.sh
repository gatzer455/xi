#!/bin/bash
# build-pi.sh — Compilar pi como binario standalone con bun
#
# Uso: ./scripts/build-pi.sh [--target linux|windows|macos]
#
# Requiere: bun instalado (curl -fsSL https://bun.sh/install | bash)
#
# El script:
# 1. Instala @earendil-works/pi-coding-agent via npm
# 2. Extrae la versión real del package instalado
# 3. Compila con bun --compile + --compile-autoload-package-json
# 4. Copia el binario + un package.json con la versión real al
#    directorio de binaries.
#
# ¿Por qué el package.json al lado del binario?
# pi detecta que corre como bun-binary y resuelve su VERSION leyendo
# <dirname del binario>/package.json. Sin ese archivo, --version
# retorna "0.0.0" (default en config.js). El flag --compile-autoload-
# package-json le dice a bun que mantenga disponible ese archivo en
# runtime; el nombre y la versión deben matchear el package original
# para que pi se identifique correctamente.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"
BINARIES_DIR="$BACKEND_DIR/binaries"
BUILD_DIR="/tmp/pi-build-$$"

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
  *)
    echo "❌ Target no soportado: $TARGET (usa: linux, windows, macos)"
    exit 1
    ;;
esac

echo "Target: $TARGET"
echo "Bun target: $BUN_TARGET"
echo "Rust triple: $RUST_TRIPLE"

# Crear directorio temporal
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Instalar pi via npm. El --silent reduce ruido, la versión real la
# extraemos del package.json resultante (no de stdout).
npm install @earendil-works/pi-coding-agent@latest --silent 2>&1 | tail -3

# Extraer la versión real del package que npm instaló.
PI_VERSION=$(node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version")
echo "Versión de pi instalada: $PI_VERSION"

# Reemplazar el package.json del proyecto. El nombre debe matchear
# el de pi para que el binario se identifique correctamente (pi
# chequea PACKAGE_NAME en config.js). La versión se inyecta desde
# PI_VERSION — sin esto, --version retorna "0.0.0".
cat > package.json <<EOF
{
  "name": "@earendil-works/pi-coding-agent",
  "version": "$PI_VERSION",
  "type": "module"
}
EOF

cat > pi-entry.js << 'ENTRY'
require('./node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
ENTRY

# Compilar con bun. --compile-autoload-package-json hace que bun
# mantenga accesible el package.json del cwd en runtime.
echo "Compilando pi con bun (target: $BUN_TARGET)..."
bun build pi-entry.js --compile --target="$BUN_TARGET" --compile-autoload-package-json --outfile pi 2>&1

# Copiar al directorio de binaries. El package.json va AL LADO del
# binario (mismo directorio, nombre 'package.json' literal): pi usa
# dirname(process.execPath) + '/package.json' para encontrarlo, o
# respeta PI_PACKAGE_DIR si está seteado.
mkdir -p "$BINARIES_DIR"
cp pi "$BINARIES_DIR/pi-$RUST_TRIPLE$BINARY_SUFFIX"
cp package.json "$BINARIES_DIR/package.json"
chmod +x "$BINARIES_DIR/pi-$RUST_TRIPLE$BINARY_SUFFIX"

echo ""
echo "✅ pi compilado y copiado a:"
echo "   $BINARIES_DIR/pi-$RUST_TRIPLE$BINARY_SUFFIX"
echo "   $BINARIES_DIR/package.json"
ls -lh "$BINARIES_DIR/pi-$RUST_TRIPLE$BINARY_SUFFIX"

# Verificación post-build: solo en linux (el binario windows no puede correr en linux)
if [[ "$TARGET" == "linux" ]]; then
  ACTUAL=$("$BINARIES_DIR/pi-$RUST_TRIPLE" --version 2>&1 | tr -d '\n')
  if [ "$ACTUAL" = "$PI_VERSION" ]; then
    echo "✅ Verificación OK: pi --version retorna $ACTUAL"
  else
    echo "❌ Verificación FAIL: pi --version retorna '$ACTUAL', esperado '$PI_VERSION'"
    echo "   Probablemente el package.json no se está leyendo correctamente."
    exit 1
  fi
else
  echo "⏭️  Verificación omitida (cross-compile a $TARGET)"
fi

# Limpiar
rm -rf "$BUILD_DIR"
