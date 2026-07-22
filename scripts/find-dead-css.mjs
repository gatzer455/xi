#!/usr/bin/env bun
/**
 * find-dead-css.mjs — Detecta selectores CSS sin uso en código SolidJS/TS.
 *
 * Usa ast-grep para extraer clases de JSX (class="...") con precisión
 * estructural, más regex para classList y manipulación vanilla del DOM.
 *
 * Uso:
 *   bun scripts/find-dead-css.mjs                 # scan
 *   bun scripts/find-dead-css.mjs --fix           # eliminar selectores
 *   bun scripts/find-dead-css.mjs --json          # salida JSON
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** Ejecuta un comando y devuelve stdout. Args seguros (sin shell). */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function findFiles(dirs, exts) {
  const dirArgs = dirs.map((d) => resolve(ROOT, d));
  const nameArgs = ["-name", `*${exts[0]}`];
  for (let i = 1; i < exts.length; i++) {
    nameArgs.push("-o", "-name", `*${exts[i]}`);
  }
  const out = run("find", [...dirArgs, "-type", "f", "(", ...nameArgs, ")"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

// ── Config ────────────────────────────────────────────────────────
const CONTENT_DIRS = [
  "apps/desktop/frontend/src",
  "apps/mobile/frontend/src",
  "packages/xi-ui/src",
];
const CONTENT_EXTS = [".tsx", ".ts"];
const CSS_DIRS = [
  "apps/desktop/frontend/src/styles",
  "apps/mobile/frontend/src/styles",
  "packages/xi-ui/src/styles",
];
const CSS_EXTS = [".css"];

const IGNORE_CLASSES = new Set([
  "html", "body", "a", "button", "textarea", "code", "pre",
  "math", "mfrac", "msqrt", "mover", "mtd", "mrow", "menclose",
  "mathcal", "mathscr", "ttf", "before", "after", "webkit-scrollbar",
]);
const RUNTIME_PREFIXES = ["md-", "tml-"];

// ── Extractores ────────────────────────────────────────────────────

/** JSX class="..." via ast-grep (precisión estructural) */
function extractJsxClasses(files) {
  const classes = new Set();
  for (const file of files) {
    const out = run("ast-grep", [
      "run", "--pattern", '<$_ $$$ class="$CLASS" $$$', "--lang", "tsx",
      "--json=stream", file,
    ]);
    if (!out) continue;
    for (const line of out.split("\n")) {
      if (!line) continue;
      const m = JSON.parse(line);
      const text = m.metaVariables?.single?.CLASS?.text;
      if (text) {
        for (const c of text.split(/\s+/)) {
          if (c && !c.startsWith("{{")) classes.add(c);
        }
      }
    }
  }
  return classes;
}

/** classList={{ 'foo': ..., 'bar': ... }} via regex */
function extractClassListClasses(files) {
  const classes = new Set();
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(/classList=\{\{\s*([^}]+)\}\}/gs)) {
      for (const km of m[1].matchAll(/['"]([^'"]+)['"]\s*:/g)) {
        classes.add(km[1]);
      }
    }
  }
  return classes;
}

/** Manipulación vanilla: .className =, .classList.add/remove/toggle, querySelector */
function extractVanillaClasses(files) {
  const classes = new Set();
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(/\.className\s*=\s*['"`]([^'"`]+)['"`]/g)) {
      for (const c of m[1].split(/\s+/)) {
        if (c && !c.startsWith("${")) classes.add(c);
      }
    }
    for (const m of content.matchAll(/\.classList\.(?:add|remove|toggle)\(['"`]([^'"`]+)['"`]/g)) {
      for (const c of m[1].split(/\s+/)) {
        if (c && !c.startsWith("${")) classes.add(c);
      }
    }
    for (const m of content.matchAll(/\.querySelector(?:All)?\(['"`]\.([^'"`\s.#[]+)['"`]/g)) {
      classes.add(m[1]);
    }
  }
  return classes;
}

/** Selectores de clase en CSS (lookbehind para evitar fragmentos BEM) */
function extractCssClasses(files) {
  const classes = new Set();
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const noComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /(?<![\w-])\.([a-zA-Z_-][\w-]*)/g;
    for (const m of noComments.matchAll(re)) {
      const name = m[1];
      if (!IGNORE_CLASSES.has(name) && !RUNTIME_PREFIXES.some((p) => name.startsWith(p))) {
        classes.add(name);
      }
    }
  }
  return classes;
}

/** Remueve un bloque CSS para una clase dada. Devuelve true si cambió. */
function removeCssBlock(cssContent, className) {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleRe = new RegExp(`[^\\n]*\\.${esc}\\s*\\{[^}]*\\}[\\s]*`, "g");
  const result = cssContent.replace(ruleRe, "");
  if (result !== cssContent) return result;
  const lineRe = new RegExp(`^[^\\n]*\\.${esc}[^\\n]*\\{[^}]*\\}[\\s]*\\n?`, "gm");
  return cssContent.replace(lineRe, "");
}

// ── Main ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const shouldFix = args.includes("--fix");
const jsonOutput = args.includes("--json");

const contentFiles = findFiles(CONTENT_DIRS, CONTENT_EXTS);
const cssFiles = findFiles(CSS_DIRS, CSS_EXTS);

const usedClasses = new Set([
  ...extractJsxClasses(contentFiles),
  ...extractClassListClasses(contentFiles),
  ...extractVanillaClasses(contentFiles),
]);

const cssFileClasses = new Map();
const allCssClasses = new Set();
for (const file of cssFiles) {
  const classes = extractCssClasses([file]);
  cssFileClasses.set(file, classes);
  for (const c of classes) allCssClasses.add(c);
}

const deadByFile = new Map();
for (const [file, cssClasses] of cssFileClasses) {
  const dead = [...cssClasses].filter((c) => !usedClasses.has(c));
  if (dead.length > 0) deadByFile.set(file, dead);
}

const totalDead = [...deadByFile.values()].reduce((s, v) => s + v.length, 0);

if (jsonOutput) {
  const report = {};
  for (const [file, dead] of deadByFile) {
    report[file.replace(ROOT + "/", "")] = dead;
  }
  console.log(JSON.stringify({
    deadClasses: report,
    stats: { usedClasses: usedClasses.size, cssClasses: allCssClasses.size, deadClasses: totalDead },
  }, null, 2));
} else if (shouldFix) {
  let removed = 0;
  let filesChanged = 0;
  for (const [file, dead] of deadByFile) {
    if (dead.length === 0) continue;
    let content = readFileSync(file, "utf8");
    for (const cls of dead) {
      const next = removeCssBlock(content, cls);
      if (next !== content) {
        content = next;
        removed++;
      }
    }
    writeFileSync(file, content);
    filesChanged++;
    console.log(`✂️ ${file.replace(ROOT + "/", "")}: ${removed} selectores`);
  }
  console.log(`\nTotal: ${removed} selectores eliminados de ${filesChanged} archivos`);
} else {
  console.log("🔍 find-dead-css — selectores CSS sin uso\n");
  console.log(`  Clases JSX/TS: ${usedClasses.size}`);
  console.log(`  Clases CSS:    ${allCssClasses.size}`);
  console.log(`  Huérfanos:     ${totalDead}\n`);
  if (totalDead === 0) {
    console.log("  ✅ Sin selectores huérfanos.\n");
    process.exit(0);
  }
  for (const [file, dead] of deadByFile) {
    console.log(`📄 ${file.replace(ROOT + "/", "")} (${dead.length})`);
    for (const cls of dead.sort()) console.log(`   .${cls}`);
    console.log();
  }
  console.log(`Ejecutá con --fix para eliminar los ${totalDead} selectores.`);
}
