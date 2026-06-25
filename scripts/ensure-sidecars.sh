#!/bin/bash
# ensure-sidecars.sh — Build sidecars solo si faltan.
#
# Se ejecuta automaticamente desde npm run dev. Si los sidecars ya
# existen, no hace nada (es rápido). Si faltan, corre los scripts
# de build con detección automática de plataforma.
#
# Determinamos el target según la plataforma actual. Si el script
# recibe --target, lo pasa a build-pi.sh (para cross-compile).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BINARIES_DIR="$PROJECT_DIR/backend/binaries"

# Detectar target
if [[ "${1:-}" == "--target" && -n "${2:-}" ]]; then
  TARGET="$2"
else
  case "$(uname -s)" in
    Linux*)  TARGET="linux" ;;
    Darwin*) TARGET="macos" ;;
    MINGW*|MSYS*) TARGET="windows" ;;
    *)       echo "Unknown platform: $(uname -s)"; exit 1 ;;
  esac
fi

# Mapear target a triple de Rust
case "$TARGET" in
  linux)  TRIPLE="x86_64-unknown-linux-gnu" ;;
  macos)  TRIPLE="aarch64-apple-darwin" ;;
  windows) TRIPLE="x86_64-pc-windows-msvc" ;;
  *)      echo "Unknown target: $TARGET"; exit 1 ;;
esac

# Extension en Windows
if [[ "$TARGET" == "windows" ]]; then
  EXT=".exe"
else
  EXT=""
fi

PI_BIN="$BINARIES_DIR/pi-$TRIPLE$EXT"
SESSIONS_BIN="$BINARIES_DIR/pi-sessions-$TRIPLE$EXT"

NEEDS_BUILD=0

if [[ ! -f "$PI_BIN" ]]; then
  echo "⚠️  sidecar pi-$TRIPLE no encontrado. Buildendo..."
  bash "$SCRIPT_DIR/build-pi.sh" --target "$TARGET"
  NEEDS_BUILD=1
fi

if [[ ! -f "$SESSIONS_BIN" ]]; then
  echo "⚠️  sidecar pi-sessions-$TRIPLE no encontrado. Buildendo..."
  bash "$SCRIPT_DIR/build-pi-sessions.sh" --target "$TARGET"
  NEEDS_BUILD=1
fi

if [[ "$NEEDS_BUILD" -eq 0 ]]; then
  echo "✅ Sidecars listos para $TARGET ($TRIPLE)"
fi
