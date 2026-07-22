#!/usr/bin/env bun
/**
 * find-dead-code.mjs — Detecta archivos TS/TSX muertos (sin importers).
 *
 * Usa ast-grep outline --items imports/exports para construir un grafo
 * de dependencias determinístico.
 *
 * Uso:
 *   bun scripts/find-dead-code.mjs                 # reporte
 *   bun scripts/find-dead-code.mjs --json          # salida JSON
 */

import { execFileSync } from "node:child_process";
import { resolve, relative, dirname, normalize } from "node:path";

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

const ALIASES = {
  "xi-ui": "packages/xi-ui/src",
  "xi-exa": "packages/xi-exa",
  "xi-flow": "packages/xi-flow",
  "xi-tools": "packages/xi-tools",
};

const ENTRY_PATTERNS = [
  /\/main\.tsx?$/,
  /vite\.config\.ts$/,
  /\/index\.ts$/,
  /\/index\.tsx$/,
  /\/vite-env\.d\.ts$/,
];

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

/** Ejecuta un comando y devuelve stdout como string. Args seguros (sin shell). */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function findFiles(dirs) {
  const args = dirs.map((d) => resolve(ROOT, d));
  const out = run("find", [
    ...args, "-type", "f",
    "(", "-name", "*.ts", "-o", "-name", "*.tsx", ")",
  ]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function outlineJson(file, itemType) {
  const out = run("ast-grep", [
    "outline", "--items", itemType, "--json=stream", file,
  ]);
  return out ? out.split("\n").filter(Boolean).map(JSON.parse) : [];
}

function normalizePath(p) {
  return normalize(p).replace(/\.(ts|tsx)$/, "");
}

function resolveImportPath(fromFile, importPath) {
  const fromDir = dirname(fromFile);

  // npm packages y CSS: ignorar
  if (!importPath.startsWith(".") && !Object.keys(ALIASES).some((a) => importPath.startsWith(a + "/"))) {
    return null;
  }

  // Path alias
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (importPath.startsWith(alias + "/")) {
      return resolve(ROOT, target, importPath.slice(alias.length + 1));
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
  // Filtrar una sola vez
  const filtered = files.filter((f) => !IGNORE_PATTERNS.some((p) => p.test(relative(ROOT, f))));

  const lookup = new Map();
  for (const file of filtered) {
    const np = normalizePath(file);
    if (!lookup.has(np)) lookup.set(np, []);
    lookup.get(np).push(file);
  }

  const graph = new Map();

  for (const file of filtered) {
    graph.set(file, { exports: new Set(), importedBy: new Set() });

    // Extraer exports e imports en una sola pasada
    const items = outlineJson(file, "exports");
    for (const item of items) {
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
        importPath = importPath.replace(/^['"]|['"]$/g, "");
        if (!importPath) continue;

        const targetAbs = resolveImportPath(file, importPath);
        if (!targetAbs) continue;

        const targetNp = normalizePath(targetAbs);
        const matches = lookup.get(targetNp);
        if (matches) {
          for (const m of matches) {
            if (graph.has(m)) graph.get(m).importedBy.add(file);
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
  console.log(JSON.stringify({ deadFiles: deadFiles.map((d) => d.file) }, null, 2));
} else {
  console.log("🔍 find-dead-code — grafo de dependencias\n");
  console.log(`  Archivos totales: ${graph.size} (${graph.size - deadFiles.length} vivos, ${deadFiles.length} candidatos)\n`);

  if (deadFiles.length === 0) {
    console.log("  ✅ Sin archivos muertos.\n");
    process.exit(0);
  }

  for (const d of deadFiles) {
    console.log(`   ${d.file}`);
    if (d.exports.length > 0) {
      console.log(`     → ${d.exports.slice(0, 6).join(", ")}${d.exports.length > 6 ? "..." : ""}`);
    }
  }

  console.log(`\n  ⚠️  Verificar manualmente: imports dinámicos y barrel files pueden dar falsos positivos.`);
}
