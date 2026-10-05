/**
 * build-pi.mjs — Descargar el binario oficial de pi (GitHub release).
 *
 * Reemplaza al compile local con bun: pi publica standalone binaries
 * multi-target (baseline runtime, SHA256SUMS) para cada versión del npm
 * package — es el mismo binario que sus releases, verificado con el
 * checksum oficial. Si la versión pineada no tiene release, el script
 * falla con un error claro (la solución es pinear la versión anterior).
 *
 * Requiere: bun install ejecutado (para leer la versión pineada de
 * node_modules). En dev usa cache: si el binario ya existe para la
 * versión pineada, no descarga (--force para re-descargar).
 *
 * Uso: node scripts/build-pi.mjs [--target linux|windows|macos|macos-intel] [--force]
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { resolve, dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { execaSync } from "execa";
import { resolveTarget } from "./lib/build-target.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const BACKEND_DIR = resolve(PROJECT_DIR, "apps", "desktop", "backend");
const BINARIES_DIR = resolve(BACKEND_DIR, "binaries");
const PI_PKG = resolve(PROJECT_DIR, "node_modules", "@earendil-works", "pi-coding-agent");

// ── Guard ──────────────────────────────────────────────────────────
if (!existsSync(resolve(PI_PKG, "package.json"))) {
  console.error("❌ @earendil-works/pi-coding-agent no encontrado en node_modules/");
  console.error("   Corre 'bun install' primero.");
  process.exit(1);
}

// ── Target ──────────────────────────────────────────────────────────
const { target: TARGET, rust, ext } = resolveTarget(process.argv);
console.log(`Target: ${TARGET}`);

// ─── Versión pineada ───────────────────────────────────────────────
const piPkgJson = JSON.parse(readFileSync(resolve(PI_PKG, "package.json"), "utf-8"));
const PI_VERSION = piPkgJson.version;
console.log(`Versión de pi pineada: ${PI_VERSION}`);

// ─── Mapa release → asset ──────────────────────────────────────────
const RELEASE_ASSETS = {
  linux:         "pi-linux-x64.tar.gz",
  windows:       "pi-windows-x64.zip",
  macos:         "pi-darwin-arm64.tar.gz",
  "macos-intel": "pi-darwin-x64.tar.gz",
};
const assetName = RELEASE_ASSETS[TARGET];
if (!assetName) die(`Target sin release oficial: ${TARGET}`);

const RELEASE_URL = `https://github.com/earendil-works/pi/releases/download/v${PI_VERSION}`;

// ─── Cache: ya tenemos el binario de esta versión ──────────────────
const binName = `pi-${rust}${ext}`;
const binPath = resolve(BINARIES_DIR, binName);
const force = process.argv.includes("--force");
if (!force && existsSync(binPath)) {
  const localPkg = resolve(BINARIES_DIR, "package.json");
  if (existsSync(localPkg)) {
    const localVersion = JSON.parse(readFileSync(localPkg, "utf-8")).version;
    if (localVersion === PI_VERSION) {
      console.log(`⏭️  Cache OK: ${binName} ya existe para v${PI_VERSION}`);
      process.exit(0);
    }
  }
}

// ─── Descargar + verificar SHA256 ──────────────────────────────────
const BUILD_DIR = resolve(tmpdir(), `pi-dl-${process.pid}`);
mkdirSync(BUILD_DIR, { recursive: true });

try {
  console.log(`Descargando ${assetName} (release v${PI_VERSION})...`);
  const resp = await fetch(`${RELEASE_URL}/${assetName}`);
  if (!resp.ok) {
    die(`Release no encontrado: ${assetName} (HTTP ${resp.status}).
   La versión pineada (v${PI_VERSION}) no tiene release oficial en
   github.com/earendil-works/pi. Pineá una versión anterior en
   package.json (root) y corré 'bun install' de nuevo.`);
  }
  const archivePath = resolve(BUILD_DIR, assetName);
  writeFileSync(archivePath, Buffer.from(await resp.arrayBuffer()));

  // Verificación con SHA256SUMS oficial
  const sumsResp = await fetch(`${RELEASE_URL}/SHA256SUMS`);
  if (!sumsResp.ok) die(`SHA256SUMS no disponible (HTTP ${sumsResp.status})`);
  const sums = await sumsResp.text();
  const expected = sums
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.endsWith(`  ${assetName}`) || l.endsWith(` ${assetName}`))
    ?.split(/\s+/)[0];
  if (!expected) die(`SHA256SUMS no incluye ${assetName}`);
  const actual = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (actual !== expected) {
    die(`❌ SHA256 mismatch para ${assetName}:
   esperado: ${expected}
   actual:   ${actual}`);
  }
  console.log("✅ SHA256 verificado contra SHA256SUMS oficial");

  // Extraer (tar maneja .tar.gz y .zip en Linux/macOS/Windows 10+)
  execaSync("tar", ["-xf", archivePath], { cwd: BUILD_DIR });
  const extracted = resolve(BUILD_DIR, "pi");
  if (!existsSync(resolve(extracted, `pi${ext}`))) {
    die(`Estructura inesperada: no está pi/pi${ext} en ${assetName}`);
  }

  // Copiar a binaries/
  mkdirSync(BINARIES_DIR, { recursive: true });
  copyFileSync(resolve(extracted, `pi${ext}`), binPath);
  copyFileSync(resolve(extracted, "package.json"), resolve(BINARIES_DIR, "package.json"));

  // node_modules nativos (clipboard) que el standalone espera al lado
  const nmSrc = resolve(extracted, "node_modules");
  if (existsSync(nmSrc)) {
    rmSync(resolve(BINARIES_DIR, "node_modules"), { recursive: true, force: true });
    copyDir(nmSrc, resolve(BINARIES_DIR, "node_modules"));
  }

  // Temas
  const themeSrc = resolve(extracted, "theme");
  const themeDst = resolve(BINARIES_DIR, "theme");
  mkdirSync(themeDst, { recursive: true });
  for (const f of ["dark.json", "light.json", "theme-schema.json"]) {
    const src = resolve(themeSrc, f);
    if (existsSync(src)) copyFileSync(src, resolve(themeDst, f));
  }

  // Ejecutable (no-op en Windows)
  if (process.platform !== "win32") {
    chmodSync(binPath, 0o755);
  }

  console.log("");
  console.log("✅ pi descargado y copiado a:");
  console.log(`   ${binPath}`);
  console.log(`   ${resolve(BINARIES_DIR, "package.json")}`);

  // Verificación de versión (solo si el binario es nativo a esta máquina)
  if (isNativeTarget(TARGET)) {
    const { stdout: actual } = execaSync(binPath, ["--version"]);
    if (actual === PI_VERSION) {
      console.log(`✅ Verificación OK: pi --version retorna ${actual}`);
    } else {
      console.error(`❌ Verificación FAIL: pi --version retorna '${actual}', esperado '${PI_VERSION}'`);
      process.exit(1);
    }
  } else {
    console.log(`⏭️  Verificación omitida (binario para ${TARGET}, host distinto)`);
  }
} finally {
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

// ─── Helpers ───────────────────────────────────────────────────────

/** ¿El binario de `target` corre nativo en esta máquina? */
function isNativeTarget(target) {
  const { platform, arch } = process;
  if (platform === "linux") return target === "linux";
  if (platform === "win32") return target === "windows";
  if (platform === "darwin") {
    return arch === "arm64" ? target === "macos" : target === "macos-intel";
  }
  return false;
}

/** Copia recursiva de directorio (node_modules de pi). */
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = resolve(src, entry);
    const d = resolve(dst, entry);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}
