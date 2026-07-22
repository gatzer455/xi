#!/usr/bin/env bun
/**
 * find-dead-code.mjs — Detecta archivos TS/TSX muertos (sin importers).
 *
 * Usa ast-grep outline --items imports/exports para construir un grafo
 * de dependencias determinístico. Sin falsos positivos de regex.
 *
 * Uso:
 *   bun scripts/find-dead-code.mjs                      # reporte
 *   bun scripts/find-dead-code.mjs --json               # salida JSON
 */

import { execSync } from "node:child_process";
import { resolve, relative, dirname, join, normalize } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// ── Config ────────────────────────────────────────────────────────
const SCAN_DIRS = [
  "apps/desktop/frontend/src",
  "apps/mobile/frontend/src",
  "packages/xi-ui/src",
  "packages/xi-exa",
  "packages/xi-flow",
  "packages/xi-tools",
];

// Path aliases (de tsconfig.json / vite.config.ts)
const ALIASES = {
  "xi-ui": "packages/xi-ui/src",
  "xi-exa": "packages/xi-exa",
  "xi-flow": "packages/xi-flow",
  "xi-tools": "packages/xi-tools",
};

// Entry points: nunca importados, pero vivos
const ENTRY_PATTERNS = [
  /\/main\.tsx?$/,
  /\/main\.ts$/,
  /vite\.config\.ts$/,
  /\/index\.ts$/,
  /\/index\.tsx$/,
  /\.config\.(ts|js|mjs)$/,
  /\/vite-env\.d\.ts$/,
];

// Archivos ignorados
const IGNORE_PATTERNS = [
  /\/tests\//,
  /\/__tests__\//,
  /\.test\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
  /\/scripts\//,
  /\/binaries\//,
  /\/dist\//,
];

// ── Helpers ────────────────────────────────────────────────────────

function findFiles(dirs) {
  const paths = dirs.map((d) => resolve(ROOT, d)).join(" ");
  const cmd = `find ${paths} -type f \\( -name '*.ts' -o -name '*.tsx' \\)`;
  try {
    return execSync(cmd, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function outlineJson(file, itemType) {
  try {
    const out = execSync(
      `ast-grep outline --items ${itemType} --json=stream "${file}"`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return out.trim().split("\n").filter(Boolean).map(JSON.parse);
  } catch {
    return [];
  }
}

/** Normaliza un path de archivo a forma canónica sin extensión */
function normalizePath(p) {
  return normalize(p).replace(/\.(ts|tsx)$/, "");
}

/** Resuelve un path de import a un path de archivo absoluto */
function resolveImportPath(fromFile, importPath) {
  const fromDir = dirname(fromFile);
  const fromRel = relative(ROOT, fromFile);

  // npm packages y CSS: ignorar
  if (!importPath.startsWith(".") && !Object.keys(ALIASES).some((a) => importPath.startsWith(a + "/") || importPath.startsWith(a + "\\"))) {
    return null;
  }

  // Path alias
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (importPath.startsWith(alias + "/")) {
      const rest = importPath.slice(alias.length + 1);
      const candidate = resolve(ROOT, target, rest);
      return candidate;
    }
  }

  // Relative path
  if (importPath.startsWith(".")) {
    return resolve(fromDir, importPath);
  }

  return null;
}

// ── Graph builder ──────────────────────────────────────────────────

function buildGraph(files) {
  // Mapa de path normalizado → [lista de absolutePaths]
  const lookup = new Map();
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (IGNORE_PATTERNS.some((p) => p.test(rel))) continue;
    const np = normalizePath(file);
    if (!lookup.has(np)) lookup.set(np, []);
    lookup.get(np).push(file);
  }

  const graph = new Map(); // absolutePath → { exports: Set, importedBy: Set }
  const filtered = files.filter((f) => {
    const rel = relative(ROOT, f);
    return !IGNORE_PATTERNS.some((p) => p.test(rel));
  });

  for (const file of filtered) {
    graph.set(file, { exports: new Set(), importedBy: new Set() });

    // Extraer exports
    for (const item of outlineJson(file, "exports")) {
      for (const entry of item.items || []) {
        if (entry.name && entry.isExported) {
          graph.get(file).exports.add(entry.name);
        }
      }
    }
  }

  // Conectar imports → exports
  for (const file of filtered) {
    for (const item of outlineJson(file, "imports")) {
      for (const entry of item.items || []) {
        let importPath = entry.name;
        if (!importPath) continue;
        // Limpiar comillas: "'./foo'" → "./foo"
        importPath = importPath.replace(/^['"]|['"]$/g, "");
        if (!importPath) continue;

        const targetAbs = resolveImportPath(file, importPath);
        if (!targetAbs) continue;

        const targetNp = normalizePath(targetAbs);
        const matches = lookup.get(targetNp);
        if (matches) {
          for (const m of matches) {
            if (graph.has(m)) {
              graph.get(m).importedBy.add(file);
            }
          }
        }
      }
    }
  }

  return graph;
}

function isEntry(relPath) {
  return ENTRY_PATTERNS.some((p) => p.test(relPath));
}

// ── Main ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");

const files = findFiles(SCAN_DIRS);
const graph = buildGraph(files);

const deadFiles = [];

for (const [file, data] of graph) {
  const rel = relative(ROOT, file);
  if (data.importedBy.size === 0 && !isEntry(rel)) {
    deadFiles.push({ file: rel, exports: [...data.exports].slice(0, 8) });
  }
}

if (jsonOutput) {
  console.log(JSON.stringify({
    deadFiles: deadFiles.map((d) => d.file),
  }, null, 2));
} else {
  console.log("🔍 find-dead-code — grafo de dependencias\n");

  const deadCount = deadFiles.length;
  const aliveCount = graph.size - deadCount;

  console.log(`  Archivos totales: ${graph.size} (${aliveCount} vivos, ${deadCount} candidatos)\n`);

  if (deadCount === 0) {
    console.log("  ✅ Sin archivos muertos.\n");
    process.exit(0);
  }

  for (const d of deadFiles) {
    console.log(`   ${d.file}`);
    if (d.exports.length > 0) {
      console.log(`     → ${d.exports.slice(0, 6).join(", ")}${d.exports.length > 6 ? "..." : ""}`);
    }
  }

  console.log(`\n  ⚠️  Verificar manualmente: imports dinámicos y barrel files\n     pueden dar falsos positivos.`);
}
