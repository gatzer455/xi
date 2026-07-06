#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# bundle-extensions.sh
#
# Compila xi-tools (Rust) y prepara los directorios de extensiones
# en resources/extensions/ para que Tauri las empaquete en el bundle.
#
# Uso:
#   ./scripts/bundle-extensions.sh [--target <rust-triple>]
#   Sin --target, compila para la plataforma nativa.
#
# Ejemplos:
#   ./scripts/bundle-extensions.sh --target x86_64-unknown-linux-gnu
#   ./scripts/bundle-extensions.sh --target aarch64-apple-darwin
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PKG_DIR="$PROJECT_DIR/packages"
RESOURCES_DIR="$PROJECT_DIR/resources/extensions"

echo "━━━ Bundleando extensiones ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Parse target ─────────────────────────────────────────────────
TARGET_TRIPLE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      TARGET_TRIPLE="$2"
      shift 2
      ;;
    *)
      echo "Error: flag no reconocido: $1"
      exit 1
      ;;
  esac
done

# ── Limpiar ───────────────────────────────────────────────────────
rm -rf "$RESOURCES_DIR"
mkdir -p "$RESOURCES_DIR"

# ── xi-tools: compilar binario Rust ───────────────────────────────
echo ""
echo "  ⚙️  Compilando xi-tools (Rust)..."

cd "$PKG_DIR/xi-tools"

CARGO_ARGS=(build --release)
if [ -n "$TARGET_TRIPLE" ]; then
  CARGO_ARGS+=(--target "$TARGET_TRIPLE")
fi

cargo "${CARGO_ARGS[@]}"
echo "  ✅ xi-tools compilado"

# Copiar a resources/
mkdir -p "$RESOURCES_DIR/xi-tools/bin"
if [ -n "$TARGET_TRIPLE" ]; then
  cp "target/${TARGET_TRIPLE}/release/xi-tools" "$RESOURCES_DIR/xi-tools/bin/xi-tools"
else
  cp "target/release/xi-tools" "$RESOURCES_DIR/xi-tools/bin/xi-tools"
fi

# Copiar el wrapper TS (no el target/ de Rust)
cp "$PKG_DIR/xi-tools/index.ts" "$RESOURCES_DIR/xi-tools/"

echo "  📦 xi-tools listo"

# ── xi-approve ────────────────────────────────────────────────────
echo "  📋 Copiando xi-approve..."
mkdir -p "$RESOURCES_DIR/xi-approve"
cp "$PKG_DIR/xi-approve/index.ts" "$RESOURCES_DIR/xi-approve/"

# ── xi-ask ────────────────────────────────────────────────────────
echo "  📋 Copiando xi-ask..."
mkdir -p "$RESOURCES_DIR/xi-ask"
cp "$PKG_DIR/xi-ask/index.ts" "$RESOURCES_DIR/xi-ask/"
cp "$PKG_DIR/xi-ask/ask-logic.ts" "$RESOURCES_DIR/xi-ask/"

# ── xi-exa ────────────────────────────────────────────────────────
echo "  📋 Copiando xi-exa..."
mkdir -p "$RESOURCES_DIR/xi-exa"
cp "$PKG_DIR/xi-exa/index.ts" "$RESOURCES_DIR/xi-exa/"
# Template sin API key (el usuario la pondrá desde settings)
cp "$PKG_DIR/xi-exa/exa-config.json" "$RESOURCES_DIR/xi-exa/"

# ── Reporte ───────────────────────────────────────────────────────
echo ""
echo "━━━ Extensiones bundleadas ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
find "$RESOURCES_DIR" -type f | sort | while read f; do
  rel="${f#$PROJECT_DIR/}"
  echo "  $rel"
done
echo ""
echo "Destino: resources/extensions/"
echo "Total archivos: $(find "$RESOURCES_DIR" -type f | wc -l)"
echo ""
