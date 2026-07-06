/**
 * xi-tools — Herramientas nativas cross-platform para pi
 *
 * Reemplaza las 7 tools built-in de pi delegando al binario xi-tools (Rust).
 *
 * Cada tool usa el mismo patrón que pi built-in:
 *   bash  → command via stdin (igual que pi con commandTransport="stdin")
 *   grep  → flags CLI (igual que pi con rg)
 *   find  → flags CLI (igual que pi con fd)
 *   ls    → spawn xi-tools ls
 *   read  → spawn xi-tools read
 *   write → content via stdin (igual que pi con fs.writeFile)
 *   edit  → edits[] JSON via stdin
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── xi-tools binary ────────────────────────────────────────────────────────

function findBinary(): string {
  // 1. Binary alongside the extension
  const extDir = dirname(fileURLToPath(import.meta.url));
  // On Windows, the bundled binary has a .exe extension
  const name = process.platform === "win32" ? "xi-tools.exe" : "xi-tools";
  const local = join(extDir, "bin", name);
  if (existsSync(local)) return local;

  // 2. Release build (desarrollo: cargo build --release)
  const release = join(extDir, "target", "release", name);
  if (existsSync(release)) return release;

  // 3. Debug build (desarrollo: cargo build)
  const debug = join(extDir, "target", "debug", name);
  if (existsSync(debug)) return debug;

  // 4. PATH lookup (shell will resolve .exe on Windows automatically)
  return "xi-tools";
}

/** Escapa un argumento para shell, manejando espacios y caracteres especiales */
function shellArg(arg: string): string {
  if (!arg.includes(" ") && !arg.includes('"') && !arg.includes("$") && !arg.includes("\\")) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Llama al binario xi-tools. Si no está disponible, lanza error.
 */
function xiSpawn(tool: string, flags: string[], stdin?: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const bin = findBinary();
    const args = [tool, ...flags];
    const isWindows = process.platform === "win32";
    const child = spawn(bin, args, {
      stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
      // On Unix, create a new process group so process.kill(-pid)
      // kills the whole command tree (shell + children).
      // On Windows, detached has different semantics — use taskkill.
      ...(!isWindows && { detached: true }),
    });

    if (stdin !== undefined) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(stdin);
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    const onAbort = () => {
      if (child.pid) {
        if (isWindows) {
          // No process groups on Windows — kill the direct child
          try { child.kill(); } catch {}
        } else {
          // Kill the process group (pid is the PGID since detached=true)
          try { process.kill(-child.pid, "SIGKILL"); } catch {}
        }
      }
    };

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, code });
    });

    child.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `xi-tools: binario no encontrado. Instálalo con: bun install -g xi-tools`
        : `xi-tools: error al ejecutar: ${err.message}`;
      reject(new Error(msg));
    });
  });
}

// ── Tool: bash ─────────────────────────────────────────────────────────────

async function execBash(params: { command: string; timeout?: number }, signal?: AbortSignal) {
  const flags: string[] = [];
  if (params.timeout) flags.push("--timeout", String(params.timeout));

  const { stdout, stderr, code } = await xiSpawn("bash", flags, params.command, signal);
  let output = stdout;
  if (stderr) output += (output ? "\n" : "") + stderr;
  if (code !== 0) output += `\n\n[exit code: ${code}]`;

  return {
    content: [{ type: "text" as const, text: output }],
    details: { exitCode: code ?? -1 },
  };
}

// ── Tool: grep ─────────────────────────────────────────────────────────────

async function execGrep(params: {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}, signal?: AbortSignal) {
  // Mismos flags que pi usa con rg, adaptados a xi-tools grep
  const flags = ["--pattern", params.pattern];
  if (params.ignoreCase) flags.push("--ignore-case");
  if (params.literal) flags.push("--literal");
  if (params.glob) flags.push("--glob", params.glob);
  if (params.context) flags.push("--context", String(params.context));
  if (params.limit) flags.push("--limit", String(params.limit));
  if (params.path) flags.push("--path", params.path);

  const { stdout, stderr, code } = await xiSpawn("grep", flags, undefined, signal);
  if (code === 2 && stderr && !stdout) {
    return {
      content: [{ type: "text" as const, text: `grep error: ${stderr.slice(0, 500)}` }],
      details: { count: 0 },
    };
  }
  return {
    content: [{ type: "text" as const, text: stdout || "No matches found." }],
    details: { count: stdout ? stdout.split("\n").filter(Boolean).length : 0, truncated: false },
  };
}

// ── Tool: find ─────────────────────────────────────────────────────────────

async function execFind(params: { pattern: string; path?: string; limit?: number }, signal?: AbortSignal) {
  // Mismos flags que pi usa con fd, adaptados a xi-tools find
  const flags = ["--pattern", params.pattern];
  if (params.limit) flags.push("--limit", String(params.limit));
  if (params.path) flags.push("--path", params.path);

  const { stdout, stderr, code } = await xiSpawn("find", flags, undefined, signal);
  if (code !== 0 && stderr && !stdout) {
    return {
      content: [{ type: "text" as const, text: `find error: ${stderr.slice(0, 500)}` }],
      details: { count: 0 },
    };
  }
  return {
    content: [{ type: "text" as const, text: stdout || "No files found." }],
    details: { count: stdout ? stdout.split("\n").filter(Boolean).length : 0, truncated: false },
  };
}

// ── Tool: ls ───────────────────────────────────────────────────────────────

async function execLs(params: { path?: string; limit?: number }, signal?: AbortSignal) {
  const flags: string[] = [];
  if (params.path) flags.push("--path", params.path);
  if (params.limit) flags.push("--limit", String(params.limit));

  const { stdout, stderr } = await xiSpawn("ls", flags, undefined, signal);
  if (stderr && !stdout) {
    return {
      content: [{ type: "text" as const, text: `ls error: ${stderr.slice(0, 500)}` }],
      details: { count: 0 },
    };
  }
  const entries = stdout.split("\n").filter(Boolean);
  return {
    content: [{ type: "text" as const, text: stdout || "(empty directory)" }],
    details: { count: entries.length, truncated: false },
  };
}

// ── Tool: read ─────────────────────────────────────────────────────────────

async function execRead(params: { path: string; offset?: number; limit?: number; hashline?: boolean }, signal?: AbortSignal) {
  const flags = ["--path", params.path];
  if (params.offset != null) flags.push("--offset", String(params.offset));
  if (params.limit != null) flags.push("--limit", String(params.limit));
  if (params.hashline !== false) flags.push("--hashline");

  const { stdout, stderr } = await xiSpawn("read", flags, undefined, signal);
  if (stderr && !stdout) {
    return {
      content: [{ type: "text" as const, text: `read error: ${stderr.slice(0, 500)}` }],
      details: {},
    };
  }
  // Extract file_hash if present
  const fhMatch = stdout.match(/--- file_hash: (\S+)/);
  const fileHash = fhMatch ? fhMatch[1] : undefined;
  return {
    content: [{ type: "text" as const, text: stdout }],
    details: { fileHash, hashline: params.hashline !== false },
  };
}

// ── Tool: write ─────────────────────────────────────────────────────────────

async function execWrite(params: { path: string; content: string }, signal?: AbortSignal) {
  const { stdout, stderr } = await xiSpawn("write", ["--path", params.path], params.content, signal);
  if (stderr && !stdout) {
    return {
      content: [{ type: "text" as const, text: `write error: ${stderr.slice(0, 500)}` }],
      details: {},
    };
  }
  return {
    content: [{ type: "text" as const, text: stdout || `Wrote to ${params.path}` }],
    details: { path: params.path, bytes: Buffer.byteLength(params.content, "utf-8") },
  };
}

// ── Tool: edit ─────────────────────────────────────────────────────────────

// Hash-anchored edit operations (recommended)
interface HashlineEdit {
  op: "replace" | "delete" | "insert_after" | "insert_before";
  start_hash?: string;
  end_hash?: string;
  hash?: string;
  lines?: string[];
}

// Legacy edit (text-based, less reliable)
interface LegacyEdit {
  oldText: string;
  newText: string;
}

type AnyEdit = HashlineEdit | LegacyEdit;

async function execEdit(params: { path: string; file_hash?: string; edits: AnyEdit[] }, signal?: AbortSignal) {
  // Mandamos edits[] + file_hash como JSON por stdin
  const input = JSON.stringify({
    path: params.path,
    file_hash: params.file_hash,
    edits: params.edits,
  });
  const { stdout, stderr, code } = await xiSpawn("edit", ["--path", params.path], input, signal);

  // Si el binario falló (exit code != 0), reportar error
  if (code !== 0 && code !== null) {
    const msg = stderr?.trim() || stdout?.trim() || "edit failed";
    // Si el mensaje ya empieza con ⛔/⚠️/✅/💡, usarlo directo (el binario ya lo formateó)
    const fullMsg = ["⛔", "⚠️", "✅", "💡"].some(p => msg.startsWith(p))
      ? msg
      : `⛔ edit error: ${msg.slice(0, 2000)}`;
    return {
      content: [{ type: "text" as const, text: fullMsg }],
      details: {},
    };
  }

  // Éxito: combinar stdout (mensaje general) + stderr (change log)
  const output = [
    stdout?.trim(),
    stderr?.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    content: [{ type: "text" as const, text: output || `✅ Applied ${params.edits.length} edit(s) to ${params.path}` }],
    details: { applied: params.edits.length },
  };
}

// ── Extension Entry Point ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ═══════════════════════════════════════════════════════════════════════
  // bash — misma interfaz que pi built-in
  // ═══════════════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "bash",
    label: "Bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    promptSnippet: "Use bash to execute commands (git, npm, cargo, etc.)",
    promptGuidelines: [
      "Use bash for terminal operations like git, npm, docker, etc. DO NOT use it for file operations.",
      "Always quote file paths containing spaces with double quotes.",
      "Use the timeout parameter for potentially long-running commands.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
    }),
    async execute(_id, params, signal) {
      return execBash(params as { command: string; timeout?: number }, signal);
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // read — misma interfaz que pi built-in
  // ═══════════════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "read",
    label: "Read",
    description: "Read the contents of a file. Output is truncated to 2000 lines or 50KB (whichever is hit first). Each line includes a 4-char content hash for hash-anchored editing. Use offset/limit for large files. The file_hash at the end enables stale-edit detection.",
    promptSnippet: "Read file contents with line hashes for reliable editing",
    promptGuidelines: [
      "Use read to examine files instead of cat or sed. Content is shown with line hashes (HASH|LINE|content).",
      "The file_hash at the bottom is REQUIRED for editing — pass it to edit as file_hash.",
      "The file_hash is file-scoped — pass the same file_hash from the most recent read of the file, regardless of offset/limit chunking.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
      offset: Type.Optional(Type.Number({ description: "Line number to start reading from (0-indexed)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
      hashline: Type.Optional(Type.Boolean({ description: "Show hashes (default: true). Set false for legacy behavior." })),
    }),
    async execute(_id, params, signal) {
      return execRead(params as Parameters<typeof execRead>[0], signal);
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // edit — misma interfaz que pi built-in
  // ═══════════════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "edit",
    label: "Edit",
    description: "Edit a file using hash-anchored line editing or legacy text replacement. Hashline mode (recommended) uses content hashes from read output to target lines precisely. Legacy mode uses oldText/newText matching. Every edit is validated before application — stale file_hash or missing hashes are rejected immediately.",
    promptSnippet: "Make precise file edits with hash-anchored lines (preferred) or text replacement",
    promptGuidelines: [
      "PREFERRED: Use hashline format — copy start_hash/end_hash from read output and pass file_hash from the read details.",
      "Hashline ops: 'replace' (start_hash/end_hash/lines), 'delete' (start_hash/end_hash), 'insert_after'/'insert_before' (hash/lines).",
      "LEGACY: Use oldText/newText for small one-off edits. Must be unique in the file. Include enough context.",
      "Always pass file_hash from the most recent read to enable stale-edit protection.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
      file_hash: Type.Optional(Type.String({ description: "File hash from the most recent read output (--- file_hash: XXXX). Enables stale-edit detection." })),
      edits: Type.Array(
        Type.Object({
          // Hashline mode (preferred)
          op: Type.Optional(Type.String({ description: "Operation: 'replace', 'delete', 'insert_after', 'insert_before'" })),
          start_hash: Type.Optional(Type.String({ description: "Hash of the first line to replace/delete" })),
          end_hash: Type.Optional(Type.String({ description: "Hash of the last line to replace/delete (same as start_hash for single line)" })),
          hash: Type.Optional(Type.String({ description: "Hash of the anchor line for insert_after/insert_before" })),
          lines: Type.Optional(Type.Array(Type.String(), { description: "New lines for replace/insert operations" })),
          // Legacy mode (text-based)
          oldText: Type.Optional(Type.String({ description: "[Legacy] Exact text to replace. Must be unique." })),
          newText: Type.Optional(Type.String({ description: "[Legacy] Replacement text." })),
        }),
        { description: "One or more targeted edits. Use hashline format (op/start_hash/end_hash/hash/lines) for reliability, or legacy format (oldText/newText) for simple cases." },
      ),
    }),
    async execute(_id, params, signal) {
      return execEdit(params as Parameters<typeof execEdit>[0], signal);
    },

    // TUI: mostrar resultado del edit con los colores del tema
    renderResult(result, _options, theme, context) {
      const text = result.content?.[0]?.text || "Done";
      const color = context.isError ? "error" : "success";
      const { Container, Text, Spacer } = await import("@earendil-works/pi-tui");
      const component = context.lastComponent ?? new Container();
      component.clear();
      component.addChild(new Spacer(1));
      component.addChild(new Text(theme.fg(color, text), 1, 0));
      return component;
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // write — misma interfaz que pi built-in
  // ═══════════════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "write",
    label: "Write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    promptSnippet: "Create or overwrite files",
    promptGuidelines: [
      "Use write only for new files or complete rewrites.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
      content: Type.String({ description: "Content to write to the file" }),
    }),
    async execute(_id, params, signal) {
      return execWrite(params as { path: string; content: string }, signal);
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // grep — misma interfaz que pi built-in
  // ═══════════════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "grep",
    label: "Grep",
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Output is truncated to 100 matches or 50KB (whichever is hit first).`,
    promptSnippet: "Search file contents with context",
    promptGuidelines: [
      "Use grep for searching file contents (not find or ls).",
      "Use glob to filter files (e.g., '*.ts').",
    ],
    parameters: Type.Object({
      pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
      path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
      glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
      ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
      literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
      context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
    }),
    async execute(_id, params, signal) {
      return execGrep(params as Parameters<typeof execGrep>[0], signal);
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // find — misma interfaz que pi built-in
  // ═══════════════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "find",
    label: "Find",
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to 1000 results or 50KB (whichever is hit first).`,
    promptSnippet: "Discover files by pattern",
    promptGuidelines: [
      "Use find for discovering files (not grep or ls).",
      "Pattern supports globs: '**/*.ts', 'src/**/*.rs'.",
    ],
    parameters: Type.Object({
      pattern: Type.String({ description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'" }),
      path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
    }),
    async execute(_id, params, signal) {
      return execFind(params as Parameters<typeof execFind>[0], signal);
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ls — misma interfaz que pi built-in
  // ═══════════════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "ls",
    label: "List",
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Output is truncated to 500 entries or 50KB (whichever is hit first).`,
    promptSnippet: "List directory contents",
    promptGuidelines: [
      "Use ls to list directory contents (not bash ls).",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
    }),
    async execute(_id, params, signal) {
      return execLs(params as { path?: string; limit?: number }, signal);
    },
  });

  console.error("[xi-tools] 7 herramientas registradas. Ejecuta 'xi-tools' en tu terminal para verificar.");
}
