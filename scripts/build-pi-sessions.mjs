/**
 * build-pi-sessions.mjs — Compilar pi-sessions como binario standalone con bun.
 *
 * Reemplaza a build-pi-sessions.sh para funcionar en Windows sin bash.
 * Requiere: bun instalado.
 *
 * Uso: node scripts/build-pi-sessions.mjs [--target linux|windows|macos|macos-intel]
 */
import { execaSync } from "execa";
import { chmodSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const SRC = resolve(PROJECT_DIR, "apps", "desktop", "backend", "scripts", "pi-sessions.ts");
const OUT_DIR = resolve(PROJECT_DIR, "apps", "desktop", "backend", "binaries");

// ── Parse target ───────────────────────────────────────────────────
const targetIdx = process.argv.indexOf("--target");
let TARGET = targetIdx !== -1 ? process.argv[targetIdx + 1] : null;

if (!TARGET) {
  const os = process.platform;
  if (os === "linux") TARGET = "linux";
  else if (os === "darwin") TARGET = process.arch === "arm64" ? "macos" : "macos-intel";
  else if (os === "win32") TARGET = "windows";
  else {
    console.error(`❌ OS no soportado: ${os}`);
    process.exit(1);
  }
}

// ─── Mapear target → bun target / rust triple / suffix ─────────────
const TARGET_MAP = {
  linux:       { bun: "bun-linux-x64",      rust: "x86_64-unknown-linux-gnu",   ext: "" },
  windows:     { bun: "bun-windows-x64",    rust: "x86_64-pc-windows-msvc",     ext: ".exe" },
  macos:       { bun: "bun-darwin-arm64",   rust: "aarch64-apple-darwin",       ext: "" },
  "macos-intel": { bun: "bun-darwin-x64",   rust: "x86_64-apple-darwin",        ext: "" },
};

const cfg = TARGET_MAP[TARGET];
if (!cfg) {
  console.error(`❌ Target no soportado: ${TARGET} (usa: linux, windows, macos, macos-intel)`);
  process.exit(1);
}

const OUT = resolve(OUT_DIR, `pi-sessions-${cfg.rust}${cfg.ext}`);

console.log(`Target: ${TARGET}`);
console.log(`Bun target: ${cfg.bun}`);
console.log(`Rust triple: ${cfg.rust}`);

// ─── Build ─────────────────────────────────────────────────────────
console.log(`Compilando pi-sessions con bun (target: ${cfg.bun})...`);
mkdirSync(OUT_DIR, { recursive: true });

execaSync("bun", [
  "build", SRC,
  "--compile",
  `--target=${cfg.bun}`,
  "--outfile", OUT,
], { stdio: "inherit" });

// Hacer ejecutable (no-op en Windows)
if (process.platform !== "win32") {
  chmodSync(OUT, 0o755);
}

console.log("");
console.log("✅ pi-sessions compilado:");
console.log(`   ${OUT}`);
