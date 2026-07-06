/**
 * ensure-sidecars.mjs — Build sidecars solo si faltan (cross-platform).
 *
 * Reemplaza a ensure-sidecars.sh para funcionar en Windows sin bash.
 * Corre desde npm run dev. Si los sidecars ya existen, es rápido.
 * Si faltan, llama a los scripts .mjs de build con detección automática
 * de plataforma + arquitectura.
 *
 * Uso: node scripts/ensure-sidecars.mjs [--target linux|macos|windows]
 */
import { execaSync } from "execa";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { resolveTarget } from "./lib/build-target.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const BINARIES_DIR = resolve(PROJECT_DIR, "apps", "desktop", "backend", "binaries");

// ── Target ──────────────────────────────────────────────────────────
const { target: TARGET, rust: TRIPLE, ext: EXT } = resolveTarget(process.argv);
const PI_BIN = resolve(BINARIES_DIR, `pi-${TRIPLE}${EXT}`);
const SESSIONS_BIN = resolve(BINARIES_DIR, `pi-sessions-${TRIPLE}${EXT}`);

function runScript(name, target) {
  const script = resolve(__dirname, name);
  execaSync("node", [script, "--target", target], {
    stdio: "inherit",
    cwd: PROJECT_DIR,
  });
}

let needsBuild = false;

if (!existsSync(PI_BIN)) {
  console.log(`⚠️  sidecar pi-${TRIPLE} no encontrado. Buildendo...`);
  runScript("build-pi.mjs", TARGET);
  needsBuild = true;
}

if (!existsSync(SESSIONS_BIN)) {
  console.log(`⚠️  sidecar pi-sessions-${TRIPLE} no encontrado. Buildendo...`);
  runScript("build-pi-sessions.mjs", TARGET);
  needsBuild = true;
}

if (!needsBuild) {
  console.log(`✅ Sidecars listos para ${TARGET} (${TRIPLE})`);
}
