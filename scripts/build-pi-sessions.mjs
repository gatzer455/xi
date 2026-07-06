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
import { resolveTarget } from "./lib/build-target.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const SRC = resolve(PROJECT_DIR, "apps", "desktop", "backend", "scripts", "pi-sessions.ts");
const OUT_DIR = resolve(PROJECT_DIR, "apps", "desktop", "backend", "binaries");

// ── Target ──────────────────────────────────────────────────────────
const { target: TARGET, bun, rust, ext } = resolveTarget(process.argv);
const OUT = resolve(OUT_DIR, `pi-sessions-${rust}${ext}`);

console.log(`Target: ${TARGET}`);
console.log(`Bun target: ${bun}`);
console.log(`Rust triple: ${rust}`);

// ─── Build ─────────────────────────────────────────────────────────
console.log(`Compilando pi-sessions con bun (target: ${bun})...`);
mkdirSync(OUT_DIR, { recursive: true });

execaSync("bun", [
  "build", SRC,
  "--compile",
  `--target=${bun}`,
  "--outfile", OUT,
], { stdio: "inherit" });

// Hacer ejecutable (no-op en Windows)
if (process.platform !== "win32") {
  chmodSync(OUT, 0o755);
}

console.log("");
console.log("✅ pi-sessions compilado:");
console.log(`   ${OUT}`);
