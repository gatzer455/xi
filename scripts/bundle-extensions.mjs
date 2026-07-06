/**
 * bundle-extensions.mjs — Compila xi-tools (Rust) y copia extensiones a resources/.
 *
 * Reemplaza a bundle-extensions.sh para funcionar en Windows sin bash.
 *
 * Uso: node scripts/bundle-extensions.mjs [--target <rust-triple>]
 */
import { execaSync } from "execa";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const PKG_DIR = resolve(PROJECT_DIR, "packages");
const RESOURCES_DIR = resolve(PROJECT_DIR, "resources", "extensions");

// ── Parse target ───────────────────────────────────────────────────
const targetIdx = process.argv.indexOf("--target");
const TARGET_TRIPLE = targetIdx !== -1 ? process.argv[targetIdx + 1] : null;

console.log("━━━ Bundleando extensiones ━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// ── Limpiar ────────────────────────────────────────────────────────
rmSync(RESOURCES_DIR, { recursive: true, force: true });
mkdirSync(RESOURCES_DIR, { recursive: true });

// ── xi-tools: compilar binario Rust ────────────────────────────────
console.log("");
console.log("  ⚙️  Compilando xi-tools (Rust)...");

const cargoArgs = ["build", "--release"];
if (TARGET_TRIPLE) cargoArgs.push("--target", TARGET_TRIPLE);

execaSync("cargo", cargoArgs, {
  cwd: resolve(PKG_DIR, "xi-tools"),
  stdio: "inherit",
});

console.log("  ✅ xi-tools compilado");

// Copiar a resources/
const xiToolsDir = resolve(RESOURCES_DIR, "xi-tools", "bin");
mkdirSync(xiToolsDir, { recursive: true });

const releaseDir = TARGET_TRIPLE
  ? resolve(PKG_DIR, "xi-tools", "target", TARGET_TRIPLE, "release")
  : resolve(PKG_DIR, "xi-tools", "target", "release");

const srcBin = resolve(releaseDir, "xi-tools");
const dstBin = resolve(xiToolsDir, "xi-tools");
const srcBinExe = srcBin + ".exe";
const dstBinExe = dstBin + ".exe";

// Copiar binario (Unix .exe-less o Windows .exe)
if (existsSync(srcBin)) {
  copyFileSync(srcBin, dstBin);
} else if (existsSync(srcBinExe)) {
  copyFileSync(srcBinExe, dstBinExe);
} else {
  console.error("❌ xi-tools binary not found after build");
  console.error(`   buscó en: ${srcBin} o ${srcBinExe}`);
  process.exit(1);
}

// Copiar wrapper TS
copyFileSync(
  resolve(PKG_DIR, "xi-tools", "index.ts"),
  resolve(RESOURCES_DIR, "xi-tools", "index.ts"),
);

console.log("  📦 xi-tools listo");

// ── xi-approve ─────────────────────────────────────────────────────
console.log("  📋 Copiando xi-approve...");
const approveDir = resolve(RESOURCES_DIR, "xi-approve");
mkdirSync(approveDir, { recursive: true });
copyFileSync(resolve(PKG_DIR, "xi-approve", "index.ts"), resolve(approveDir, "index.ts"));

// ── xi-ask ─────────────────────────────────────────────────────────
console.log("  📋 Copiando xi-ask...");
const askDir = resolve(RESOURCES_DIR, "xi-ask");
mkdirSync(askDir, { recursive: true });
copyFileSync(resolve(PKG_DIR, "xi-ask", "index.ts"), resolve(askDir, "index.ts"));
copyFileSync(resolve(PKG_DIR, "xi-ask", "ask-logic.ts"), resolve(askDir, "ask-logic.ts"));

// ── xi-exa ─────────────────────────────────────────────────────────
console.log("  📋 Copiando xi-exa...");
const exaDir = resolve(RESOURCES_DIR, "xi-exa");
mkdirSync(exaDir, { recursive: true });
copyFileSync(resolve(PKG_DIR, "xi-exa", "index.ts"), resolve(exaDir, "index.ts"));
copyFileSync(resolve(PKG_DIR, "xi-exa", "exa-config.json"), resolve(exaDir, "exa-config.json"));

// ── Reporte ───────────────────────────────────────────────────────
console.log("");
console.log("━━━ Extensiones bundleadas ─━━━━━━━━━━━━━━━━━━━━━━━━━━━");

let total = 0;
for (const ext of ["xi-tools", "xi-approve", "xi-ask", "xi-exa"]) {
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
