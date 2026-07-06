/**
 * ensure-sidecars.js — Build sidecars solo si faltan (cross-platform).
 *
 * Reemplaza a ensure-sidecars.sh para funcionar en Windows sin bash.
 * Corre desde npm run dev. Si los sidecars ya existen, es rápido.
 * Si faltan, llama a los scripts de build con detección automática
 * de plataforma + arquitectura.
 *
 * Uso: node scripts/ensure-sidecars.js [--target linux|macos|windows]
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname, sep } from "path";
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
  else if (os === "darwin") TARGET = "macos";
  else if (os === "win32") TARGET = "windows";
  else {
    console.error(`Unknown platform: ${os}`);
    process.exit(1);
  }
}

// Detectar CPU para escoger el triple correcto.
// Apple Silicon desde Node os.arch(): arm64
// Intel: x64
// Linux ARM (Raspberry Pi, etc.): arm64
const arch = process.arch;

// Mapear target + arch a triple de Rust
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

// Buscar bash: en Windows puede estar en varios lugares.
function findBash() {
  if (process.platform !== "win32") return "bash";
  const candidates = [
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\ProgramData\\chocolatey\\bin\\bash.exe",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fallback: asumir que bash está en PATH (git bash, WSL, etc.)
  return "bash";
}

const BASH = findBash();

let needsBuild = false;

if (!existsSync(PI_BIN)) {
  console.log(`⚠️  sidecar pi-${TRIPLE} no encontrado. Buildendo...`);
  execSync(`"${BASH}" ${resolve(__dirname, "build-pi.sh")} --target ${TARGET}`, {
    stdio: "inherit",
    cwd: PROJECT_DIR,
  });
  needsBuild = true;
}

if (!existsSync(SESSIONS_BIN)) {
  console.log(`⚠️  sidecar pi-sessions-${TRIPLE} no encontrado. Buildendo...`);
  execSync(`"${BASH}" ${resolve(__dirname, "build-pi-sessions.sh")} --target ${TARGET}`, {
    stdio: "inherit",
    cwd: PROJECT_DIR,
  });
  needsBuild = true;
}

if (!needsBuild) {
  console.log(`✅ Sidecars listos para ${TARGET} (${TRIPLE})`);
}
