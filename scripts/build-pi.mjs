/**
 * build-pi.mjs — Compilar pi como binario standalone con bun.
 *
 * Reemplaza a build-pi.sh para funcionar en Windows sin bash.
 * Requiere: bun instalado, npm install ejecutado.
 *
 * Uso: node scripts/build-pi.mjs [--target linux|windows|macos|macos-intel]
 */
import { execaSync } from "execa";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const BACKEND_DIR = resolve(PROJECT_DIR, "apps", "desktop", "backend");
const BINARIES_DIR = resolve(BACKEND_DIR, "binaries");
const PI_PKG = resolve(PROJECT_DIR, "node_modules", "@earendil-works", "pi-coding-agent");

// ── Guard ──────────────────────────────────────────────────────────
if (!existsSync(resolve(PI_PKG, "package.json"))) {
  console.error("❌ @earendil-works/pi-coding-agent no encontrado en node_modules/");
  console.error("   Corre 'npm install' primero.");
  process.exit(1);
}

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

console.log(`Target: ${TARGET}`);
console.log(`Bun target: ${cfg.bun}`);
console.log(`Rust triple: ${cfg.rust}`);

// ─── Extraer versión de pi ─────────────────────────────────────────
const piPkgJson = JSON.parse(readFileSync(resolve(PI_PKG, "package.json"), "utf-8"));
const PI_VERSION = piPkgJson.version;
console.log(`Versión de pi pineada: ${PI_VERSION}`);

// ─── Build en temp dir ─────────────────────────────────────────────
const BUILD_DIR = resolve(tmpdir(), `pi-build-${process.pid}`);
mkdirSync(BUILD_DIR, { recursive: true });

try {
  // Copiar package.json de pi (necesario para --compile-autoload-package-json)
  copyFileSync(resolve(PI_PKG, "package.json"), resolve(BUILD_DIR, "package.json"));

  // Crear entry point
  writeFileSync(
    resolve(BUILD_DIR, "pi-entry.js"),
    "require('./node_modules/@earendil-works/pi-coding-agent/dist/cli.js');\n",
  );

  // Copiar node_modules de pi
  const nmDir = resolve(BUILD_DIR, "node_modules", "@earendil-works");
  mkdirSync(nmDir, { recursive: true });
  cpSync(PI_PKG, resolve(nmDir, "pi-coding-agent"), { recursive: true });

  // Compilar
  console.log(`Compilando pi con bun (target: ${cfg.bun})...`);
  execaSync("bun", [
    "build", "pi-entry.js",
    "--compile",
    `--target=${cfg.bun}`,
    "--compile-autoload-package-json",
    "--outfile", "pi",
  ], { cwd: BUILD_DIR, stdio: "inherit" });

  // Copiar a binaries/
  mkdirSync(BINARIES_DIR, { recursive: true });
  const binName = `pi-${cfg.rust}${cfg.ext}`;
  copyFileSync(resolve(BUILD_DIR, `pi${cfg.ext}`), resolve(BINARIES_DIR, binName));
  copyFileSync(resolve(BUILD_DIR, "package.json"), resolve(BINARIES_DIR, "package.json"));

  // Copiar temas
  const themeSrc = resolve(PI_PKG, "dist", "modes", "interactive", "theme");
  const themeDst = resolve(BINARIES_DIR, "theme");
  mkdirSync(themeDst, { recursive: true });
  if (existsSync(themeSrc)) {
    for (const f of ["dark.json", "light.json", "theme-schema.json"]) {
      const src = resolve(themeSrc, f);
      if (existsSync(src)) copyFileSync(src, resolve(themeDst, f));
    }
  }

  // Hacer ejecutable (no-op en Windows)
  if (process.platform !== "win32") {
    chmodSync(resolve(BINARIES_DIR, binName), 0o755);
  }

  console.log("");
  console.log("✅ pi compilado y copiado a:");
  console.log(`   ${resolve(BINARIES_DIR, binName)}`);
  console.log(`   ${resolve(BINARIES_DIR, "package.json")}`);

  // Verificación post-build (solo linux)
  if (TARGET === "linux") {
    const { stdout: actual } = execaSync(resolve(BINARIES_DIR, binName), ["--version"]);
    if (actual === PI_VERSION) {
      console.log(`✅ Verificación OK: pi --version retorna ${actual}`);
    } else {
      console.error(`❌ Verificación FAIL: pi --version retorna '${actual}', esperado '${PI_VERSION}'`);
      console.error("   Probablemente el package.json no se está leyendo correctamente.");
      process.exit(1);
    }
  } else {
    console.log(`⏭️  Verificación omitida (cross-compile a ${TARGET})`);
  }
} finally {
  rmSync(BUILD_DIR, { recursive: true, force: true });
}
