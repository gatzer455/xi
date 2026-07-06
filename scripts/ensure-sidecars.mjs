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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const BINARIES_DIR = resolve(PROJECT_DIR, "apps", "desktop", "backend", "binaries");

// Detectar target
const targetIdx = process.argv.indexOf("--target");
let TARGET = targetIdx !== -1 ? process.argv[targetIdx + 1] : null;

if (!TARGET) {
  const os = process.platform;
  if (os === "linux") TARGET = "linux";
  else if (os === "darwin") TARGET = process.arch === "arm64" ? "macos" : "macos-intel";
  else if (os === "win32") TARGET = "windows";
  else {
    console.error(`Unknown platform: ${os}`);
    process.exit(1);
  }
}

const arch = process.arch;

function triple(target, arch) {
  switch (target) {
    case "linux":
      return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
    case "macos":
      return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    case "windows":
      return "x86_64-pc-windows-msvc";
    default:
      return null;
  }
}

const TRIPLE = triple(TARGET, arch);
if (!TRIPLE) {
  console.error(`Unknown target: ${TARGET}`);
  process.exit(1);
}

const EXT = TARGET === "windows" ? ".exe" : "";
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
