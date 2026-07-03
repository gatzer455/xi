#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# bundle-extensions.sh
#
# Compila xi-tools (Rust) y prepara los directorios de extensiones
# en resources/extensions/ para que Tauri las empaquete en el bundle.
#
# Uso:
#   ./scripts/bundle-extensions.sh [--target linux|macos|windows]
#   Sin --target, compila para la plataforma nativa.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
EXT_DIR="$PROJECT_DIR/extensions"
RESOURCES_DIR="$PROJECT_DIR/resources/extensions"

echo "━━━ Bundleando extensiones ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Parse target ─────────────────────────────────────────────────
TARGET_TRIPLE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      case $2 in
        linux)   TARGET_TRIPLE="x86_64-unknown-linux-gnu" ;;
        macos)   TARGET_TRIPLE="x86_64-apple-darwin" ;;
        windows) TARGET_TRIPLE="x86_64-pc-windows-msvc" ;;
        *) echo "Error: target no reconocido: $2. Usa linux, macos o windows."; exit 1 ;;
      esac
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

cd "$EXT_DIR/xi-tools"

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
cp "$EXT_DIR/xi-tools/index.ts" "$RESOURCES_DIR/xi-tools/"

echo "  📦 xi-tools listo"

# ── pi-approve ────────────────────────────────────────────────────
echo "  📋 Copiando pi-approve..."
mkdir -p "$RESOURCES_DIR/pi-approve"
cp "$EXT_DIR/pi-approve/index.ts" "$RESOURCES_DIR/pi-approve/"

# ── pi-ask ────────────────────────────────────────────────────────
echo "  📋 Copiando pi-ask..."
mkdir -p "$RESOURCES_DIR/pi-ask"
cp "$EXT_DIR/pi-ask/index.ts" "$RESOURCES_DIR/pi-ask/"
cp "$EXT_DIR/pi-ask/ask-logic.ts" "$RESOURCES_DIR/pi-ask/"

# ── pi-exa ────────────────────────────────────────────────────────
echo "  📋 Copiando pi-exa..."
mkdir -p "$RESOURCES_DIR/pi-exa"
cp "$EXT_DIR/pi-exa/index.ts" "$RESOURCES_DIR/pi-exa/"
# Template sin API key (el usuario la pondrá desde settings)
echo '{"apiKey": null}' > "$RESOURCES_DIR/pi-exa/exa-config.json"

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
