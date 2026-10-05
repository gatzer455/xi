/**
 * bundle-extensions.mjs — Copia las extensiones (xi-flow, xi-exa) a resources/.
 *
 * Uso: node scripts/bundle-extensions.mjs
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const PKG_DIR = resolve(PROJECT_DIR, "packages");
const RESOURCES_DIR = resolve(PROJECT_DIR, "resources", "extensions");

console.log("━━━ Bundleando extensiones ━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// ── Limpiar ────────────────────────────────────────────────────────
rmSync(RESOURCES_DIR, { recursive: true, force: true });
mkdirSync(RESOURCES_DIR, { recursive: true });
writeFileSync(resolve(RESOURCES_DIR, ".gitkeep"), "");

// ── xi-flow ───────────────────────────────────────────────────
console.log("  📋 Copiando xi-flow...");
const flowtoolsDir = resolve(RESOURCES_DIR, "xi-flow");
mkdirSync(flowtoolsDir, { recursive: true });
copyFileSync(resolve(PKG_DIR, "xi-flow", "index.ts"), resolve(flowtoolsDir, "index.ts"));
copyFileSync(resolve(PKG_DIR, "xi-flow", "approve.ts"), resolve(flowtoolsDir, "approve.ts"));
copyFileSync(resolve(PKG_DIR, "xi-flow", "ask.ts"), resolve(flowtoolsDir, "ask.ts"));
copyFileSync(resolve(PKG_DIR, "xi-flow", "ask-logic.ts"), resolve(flowtoolsDir, "ask-logic.ts"));
copyFileSync(resolve(PKG_DIR, "xi-flow", "nested-context.ts"), resolve(flowtoolsDir, "nested-context.ts"));
copyFileSync(resolve(PKG_DIR, "xi-flow", "mentions.ts"), resolve(flowtoolsDir, "mentions.ts"));

// ── xi-exa ─────────────────────────────────────────────────────────
console.log("  📋 Copiando xi-exa...");
const exaDir = resolve(RESOURCES_DIR, "xi-exa");
mkdirSync(exaDir, { recursive: true });
copyFileSync(resolve(PKG_DIR, "xi-exa", "index.ts"), resolve(exaDir, "index.ts"));

// ── Reporte ───────────────────────────────────────────────────────
console.log("");
console.log("━━━ Extensiones bundleadas ─━━━━━━━━━━━━━━━━━━━━━━━━━━━");

let total = 0;
for (const ext of ["xi-flow", "xi-exa"]) {
  const dir = resolve(RESOURCES_DIR, ext);
  const entries = readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile());
  for (const e of entries) {
    console.log(`  resources/extensions/${ext}/${e.name}`);
  }
  total += entries.length;
}

console.log("");
console.log(`Destino: resources/extensions/`);
console.log(`Total archivos: ${total}`);
console.log("");
