/**
 * build-target.mjs — Resolución de target cross-platform para scripts de build.
 *
 * Unifica la lógica de detección de plataforma + mapeo a bun target / rust triple
 * que antes estaba duplicada en build-pi.mjs y build-pi-sessions.mjs.
 *
 * Uso:
 *   import { resolveTarget } from "./lib/build-target.mjs";
 *   const { target, bun, rust, ext } = resolveTarget(process.argv);
 */

import { arch, platform } from "os";

const TARGET_MAP = {
  linux:         { bun: "bun-linux-x64",      rust: "x86_64-unknown-linux-gnu",   ext: "" },
  windows:       { bun: "bun-windows-x64",    rust: "x86_64-pc-windows-msvc",     ext: ".exe" },
  macos:         { bun: "bun-darwin-arm64",   rust: "aarch64-apple-darwin",       ext: "" },
  "macos-intel": { bun: "bun-darwin-x64",     rust: "x86_64-apple-darwin",        ext: "" },
};

/**
 * Resuelve el target desde --target CLI o detecta la plataforma actual.
 * @param {string[]} argv process.argv
 * @returns {{ target: string, bun: string, rust: string, ext: string }}
 */
export function resolveTarget(argv) {
  const idx = argv.indexOf("--target");
  let target = idx !== -1 ? argv[idx + 1] : null;

  if (!target) {
    const os = platform();
    if (os === "linux") target = "linux";
    else if (os === "darwin") target = arch() === "arm64" ? "macos" : "macos-intel";
    else if (os === "win32") target = "windows";
    else die(`OS no soportado: ${os}`);
  }

  const cfg = TARGET_MAP[target];
  if (!cfg) die(`Target no soportado: ${target} (usa: linux, windows, macos, macos-intel)`);

  return { target, ...cfg };
}

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}
