/**
 * xi-exa — Web & code search via Exa API v2.0.0
 *
 * Tool set mirrors the official Exa MCP server shape:
 *   default:     web_search_exa, web_fetch_exa
 *   opt-in:      web_search_advanced_exa, exa_answer
 *   deprecated:  get_code_context_exa, crawling_exa (opt-in, kept for compat)
 *
 * Gating: `tools` array in ~/.pi/config/exa-config.json.
 * Absent => defaults above (same semantics as the official `?tools=` param).
 *
 * API reference: https://exa.ai/docs/reference/search-api-guide-for-coding-agents
 * Code search:   https://exa.ai/docs/reference/context
 * Contents:      https://exa.ai/docs/reference/contents-api-guide-for-coding-agents
 * Answer:        https://exa.ai/docs/reference/answer
 *
 * Self-check: `NODE_PATH=<pi global node_modules> bun index.ts`
 *
 * Last verified against API: 2026-07-10
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── Types ──────────────────────────────────────────────────────────────────

interface ExaConfig {
  apiKey: string | null;
  tools?: string[];
}

interface SearchResult {
  title: string;
  url: string;
  id?: string;
  snippet?: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  text?: string;
  highlights?: string[];
  summary?: string;
  favicon?: string;
  image?: string;
}

interface CrawlResult {
  url: string;
  id?: string;
  title?: string;
  text?: string;
  author?: string;
  publishedDate?: string;
  highlights?: string[];
  summary?: string;
}

// ── Config ─────────────────────────────────────────────────────────────────

function tryReadConfig(filePath: string): ExaConfig | null {
  try {
    const { readFileSync } = require("node:fs");
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    const cfg: ExaConfig = { apiKey: raw.apiKey || null };
    if (Array.isArray(raw.tools)) cfg.tools = raw.tools.map(String);
    return cfg;
  } catch {
    return null;
  }
}

function getExaConfig(): ExaConfig {
  let fileCfg: ExaConfig = { apiKey: null };

  try {
    const { homedir } = require("node:os");
    const { join } = require("node:path");

    // 1. Central config (~/.pi/config/exa-config.json)
    const central = tryReadConfig(join(homedir(), ".pi", "config", "exa-config.json"));
    if (central) fileCfg = central;
    else {
      // 2. Fallback: extension dir (legacy)
      const { dirname } = require("node:path");
      const { fileURLToPath } = require("node:url");
      const extDir = dirname(fileURLToPath(import.meta.url));
      const legacy = tryReadConfig(join(extDir, "exa-config.json"));
      if (legacy) fileCfg = legacy;
    }
  } catch (err) {
    console.error("[xi-exa] Could not load config:", err);
  }

  // Env key overrides only the key; `tools` always comes from the file.
  return {
    apiKey: process.env.EXA_API_KEY || fileCfg.apiKey,
    tools: fileCfg.tools,
  };
}

// ── Tool gating & usage guide ──────────────────────────────────────────────

const DEFAULT_TOOLS = ["web_search_exa", "web_fetch_exa"];

const TOOL_GUIDE: Record<string, { best: string; cost: string }> = {
  web_search_exa: {
    best: "General web search, current events, factual info",
    cost: "Low",
  },
  web_fetch_exa: {
    best: "Read full content of a known URL (one or more)",
    cost: "Low",
  },
  get_code_context_exa: {
    best: "Deprecated — use web_search_exa",
    cost: "Low",
  },
  crawling_exa: {
    best: "Deprecated — use web_fetch_exa",
    cost: "Low",
  },
  exa_answer: {
    best: "Direct answer with citations (search + LLM)",
    cost: "Medium",
  },
  web_search_advanced_exa: {
    best: "Filtered search: dates, domains, categories, structured output",
    cost: "Variable",
  },
};

function buildGuide(enabled: string[]): string {
  const rows = enabled
    .map((t) => `| \`${t}\` | ${TOOL_GUIDE[t].best} | ${TOOL_GUIDE[t].cost} |`)
    .join("\n");
  return `## Exa Search Tools — Usage Guide

Prefer the cheapest tool. NEVER use type="deep"/"deep-reasoning" unless explicitly asked.

| Tool | Best for | Cost |
|------|----------|------|
${rows}`;
}

// ── Parsing helpers ────────────────────────────────────────────────────────

/**
 * Parses tokensNum parameter: accepts number, "dynamic", or number-like string.
 * Exa API v2.0.0 /context expects a number or the literal string "dynamic".
 */
function parseTokensNum(val: unknown): number | "dynamic" {
  if (val === "dynamic" || val === undefined || val === null) return "dynamic";
  const n = Number(val);
  if (!isNaN(n) && isFinite(n)) return n;
  return "dynamic";
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

const EXA_BASE = "https://api.exa.ai";

async function exaPost(
  apiKey: string | null,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(`${EXA_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "(no error body)");
    throw new Error(`Exa API error ${res.status}: ${errorText.slice(0, 300)}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

// ── Contents builder (v2.0.0) ─────────────────────────────────────────────

function buildContentsOpts(opts: {
  maxCharacters?: number;
  maxAgeHours?: number;
  subpages?: number;
  subpageTarget?: string;
  extrasLinks?: number;
  extrasImageLinks?: number;
}): Record<string, unknown> {
  const contents: Record<string, unknown> = {};

  if (opts.maxCharacters && opts.maxCharacters > 0) {
    contents.text = { maxCharacters: opts.maxCharacters };
    contents.highlights = {
      maxCharacters: Math.min(opts.maxCharacters, 4000),
    };
  } else {
    contents.highlights = true;
  }

  if (opts.maxAgeHours !== undefined) {
    contents.maxAgeHours = opts.maxAgeHours;
  }
  if (opts.subpages && opts.subpages > 0) {
    contents.subpages = opts.subpages;
    if (opts.subpageTarget) {
      contents.subpageTarget = opts.subpageTarget
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  if ((opts.extrasLinks ?? 0) > 0 || (opts.extrasImageLinks ?? 0) > 0) {
    contents.extras = {
      ...(opts.extrasLinks ? { links: opts.extrasLinks } : {}),
      ...(opts.extrasImageLinks ? { imageLinks: opts.extrasImageLinks } : {}),
    };
  }

  return contents;
}

// ── Formatting ─────────────────────────────────────────────────────────────

function formatSearchResults(
  results: SearchResult[],
  responseData: Record<string, unknown>
): string {
  if (!results.length) return "No results found.";

  const lines: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`### ${i + 1}. ${r.title || r.url}`);
    lines.push(`URL: ${r.url}`);

    if (r.publishedDate) lines.push(`Published: ${r.publishedDate}`);
    if (r.author) lines.push(`Author: ${r.author}`);

    if (r.highlights?.length) {
      lines.push("");
      lines.push(r.highlights.join("\n\n"));
    } else if (r.text) {
      lines.push("");
      lines.push(r.text);
    } else if (r.summary) {
      lines.push("");
      lines.push(r.summary);
    } else if (r.snippet) {
      lines.push("");
      lines.push(r.snippet);
    }

    if (i < results.length - 1) lines.push("\n---\n");
  }

  const text = lines.join("\n");
  const cost = (responseData as any).costDollars;
  if (cost?.total !== undefined) {
    return `${text}\n\n*Cost: $${cost.total.toFixed(4)}*`;
  }
  return text;
}

function formatCrawlResults(results: CrawlResult[]): string {
  if (!results.length) return "No content found.";

  return results
    .map((r) => {
      let block = `## ${r.title || r.url}\n`;
      block += `URL: ${r.url}\n`;
      if (r.author) block += `Author: ${r.author}\n`;
      if (r.publishedDate) block += `Published: ${r.publishedDate}\n`;
      if (r.highlights?.length) {
        block += `\n${r.highlights.join("\n\n")}\n`;
      } else {
        block += `\n${r.text || "(no content)"}\n`;
      }
      return block;
    })
    .join("\n---\n");
}

/**
 * Formats /context response into markdown code blocks.
 * The response field already contains formatted code snippets.
 */
function formatContextResults(data: Record<string, unknown>): string {
  const response = data.response as string | undefined;
  if (!response) return "No code examples found.";

  const count = data.resultsCount as number | undefined;
  const cost = (data as any).costDollars;
  const footer = [
    count ? `\n\n*Results: ${count}*` : "",
    cost?.total !== undefined ? ` *Cost: $${cost.total.toFixed(4)}*` : "",
  ]
    .filter(Boolean)
    .join("");

  return response + footer;
}

/**
 * Formats /answer response.
 */
function formatAnswerResults(data: Record<string, unknown>): string {
  const answer = data.answer as string | undefined;
  const citations = data.citations as Array<{ url: string; title?: string }> | undefined;

  let text = answer || "No answer generated.";

  if (citations?.length) {
    text += "\n\n**Sources:**\n";
    for (const c of citations) {
      text += `- [${c.title || c.url}](${c.url})\n`;
    }
  }

  const cost = (data as any).costDollars;
  if (cost?.total !== undefined) {
    text += `\n\n*Cost: $${cost.total.toFixed(4)}*`;
  }

  return text;
}

// ── Core operations ────────────────────────────────────────────────────────

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, never>;
};

async function search(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResult> {
  const body: Record<string, unknown> = {
    query: params.query,
    numResults: (params.numResults as number) ?? 10,
    contents: buildContentsOpts({
      maxCharacters: params.maxCharacters as number | undefined,
      maxAgeHours: params.maxAgeHours as number | undefined,
      subpages: params.subpages as number | undefined,
      subpageTarget: params.subpageTarget as string | undefined,
      extrasLinks: params.extrasLinks as number | undefined,
      extrasImageLinks: params.extrasImageLinks as number | undefined,
    }),
  };

  // Optional top-level filters
  if (params.type && params.type !== "auto") body.type = params.type;
  if (params.category) body.category = params.category;
  if (params.userLocation) body.userLocation = params.userLocation;
  if (params.startPublishedDate) body.startPublishedDate = params.startPublishedDate;
  if (params.endPublishedDate) body.endPublishedDate = params.endPublishedDate;
  if (params.moderation) body.moderation = params.moderation;
  if (params.additionalQueries) {
    const aq = params.additionalQueries as string;
    body.additionalQueries = aq.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (params.systemPrompt) body.systemPrompt = params.systemPrompt;
  if (params.outputSchema) {
    try {
      body.outputSchema =
        typeof params.outputSchema === "string"
          ? JSON.parse(params.outputSchema as string)
          : params.outputSchema;
    } catch { /* ignore invalid JSON */ }
  }

  if (params.includeDomains) {
    body.includeDomains = String(params.includeDomains)
      .split(",")
      .map((d) => d.trim());
  }
  if (params.excludeDomains) {
    body.excludeDomains = String(params.excludeDomains)
      .split(",")
      .map((d) => d.trim());
  }

  const data = await exaPost(apiKey, "/search", body, signal);
  const results = data.results as SearchResult[] | undefined;
  const text = formatSearchResults(results || [], data);

  return { content: [{ type: "text", text }], details: {} };
}

async function contextSearch(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResult> {
  const body: Record<string, unknown> = {
    query: params.query,
    tokensNum: parseTokensNum(params.tokensNum),
  };

  const data = await exaPost(apiKey, "/context", body, signal);
  const text = formatContextResults(data);

  return { content: [{ type: "text", text }], details: {} };
}

async function fetchUrls(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResult> {
  const urls = Array.isArray(params.urls)
    ? (params.urls as string[])
    : [String(params.url)];
  const body: Record<string, unknown> = {
    urls,
    ...buildContentsOpts({
      maxCharacters: params.maxCharacters as number | undefined,
      maxAgeHours: params.maxAgeHours as number | undefined,
      subpages: params.subpages as number | undefined,
      subpageTarget: params.subpageTarget as string | undefined,
      extrasLinks: params.extrasLinks as number | undefined,
      extrasImageLinks: params.extrasImageLinks as number | undefined,
    }),
  };

  const data = await exaPost(apiKey, "/contents", body, signal);
  const results = data.results as CrawlResult[] | undefined;
  const text = formatCrawlResults(results || []);

  return { content: [{ type: "text", text }], details: {} };
}

async function answer(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResult> {
  const body: Record<string, unknown> = {
    query: params.query,
  };

  if (params.text) body.text = params.text;

  const data = await exaPost(apiKey, "/answer", body, signal);
  const text = formatAnswerResults(data);

  return { content: [{ type: "text", text }], details: {} };
}

// ── Safe execute wrapper ───────────────────────────────────────────────────

async function safeExecute(
  apiKey: string | null,
  fn: () => Promise<ToolResult>
): Promise<ToolResult> {
  if (!apiKey) {
    return {
      content: [
        {
          type: "text",
          text: "Error: Exa API key not configured. Set EXA_API_KEY env var or add it in Settings.",
        },
      ],
      details: {},
    };
  }

  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[xi-exa] Tool error:", err);
    return { content: [{ type: "text", text: `Error: ${message}` }], details: {} };
  }
}

// ── Extension ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const config = getExaConfig();
  const tools = config.tools ?? DEFAULT_TOOLS;
  const has = (name: string) => tools.includes(name);

  // ── Usage guidance injected at session start (only lists enabled tools) ──
  pi.on("session_start", () => {
    pi.sendMessage(
      {
        customType: "xi-exa-guidance",
        content: buildGuide(tools),
        display: false,
      },
      { deliverAs: "steer" }
    );
  });

  // web_search_exa — basic web search (default)
  if (has("web_search_exa")) {
    pi.registerTool({
      name: "web_search_exa",
      label: "Web Search (Exa)",
      description:
        "Search the web for any topic and get clean, ready-to-use content with links to sources.",
      promptSnippet:
        "Search the web for current information, news, or topics needing up-to-date data",
      parameters: Type.Object({
        query: Type.String({ description: "The search query" }),
        numResults: Type.Optional(
          Type.Integer({ description: "Number of results (default 10, max 100)" })
        ),
        maxCharacters: Type.Optional(
          Type.Integer({
            description: "Max chars of page text per result. Omit for highlights only (cheaper).",
          })
        ),
        maxAgeHours: Type.Optional(
          Type.Integer({
            description: "Max cached age in hours. 0 = livecrawl, -1 = cache only.",
          })
        ),
      }),
      async execute(_id, params, signal) {
        const c = getExaConfig();
        return safeExecute(c.apiKey, () =>
          search(c.apiKey, params as Record<string, unknown>, signal)
        );
      },
    });
  }

  // web_fetch_exa — read one or more URLs (default)
  if (has("web_fetch_exa")) {
    pi.registerTool({
      name: "web_fetch_exa",
      label: "Fetch URLs (Exa)",
      description:
        "Read a webpage's full content as clean markdown from one or more URLs.",
      promptSnippet: "Extract full content from one or more URLs",
      parameters: Type.Object({
        urls: Type.Array(Type.String(), {
          description: "One or more URLs to fetch",
        }),
        maxCharacters: Type.Optional(
          Type.Integer({ description: "Max chars to return per URL (default 10000)" })
        ),
        maxAgeHours: Type.Optional(
          Type.Integer({
            description: "Max cached age in hours. 0 = livecrawl, -1 = cache only.",
          })
        ),
        subpages: Type.Optional(
          Type.Integer({ description: "Subpages per result (0 disables)" })
        ),
        subpageTarget: Type.Optional(
          Type.String({ description: "Subpage source: 'sources', 'mentions'" })
        ),
        extrasLinks: Type.Optional(
          Type.Integer({ description: "External links to extract per result" })
        ),
        extrasImageLinks: Type.Optional(
          Type.Integer({ description: "Image links to extract per result" })
        ),
      }),
      async execute(_id, params, signal) {
        const c = getExaConfig();
        return safeExecute(c.apiKey, () =>
          fetchUrls(c.apiKey, params as Record<string, unknown>, signal)
        );
      },
    });
  }

  // crawling_exa — single-URL fetch (deprecated, use web_fetch_exa)
  if (has("crawling_exa")) {
    pi.registerTool({
      name: "crawling_exa",
      label: "Crawl URL (Exa)",
      description:
        "Deprecated — use web_fetch_exa. Get the full content of a specific webpage from a known URL.",
      promptSnippet: "Deprecated — use web_fetch_exa",
      parameters: Type.Object({
        url: Type.String({ description: "The URL to crawl" }),
        maxCharacters: Type.Optional(
          Type.Integer({ description: "Max chars to return (default 10000)" })
        ),
        maxAgeHours: Type.Optional(
          Type.Integer({
            description: "Max cached age in hours. 0 = livecrawl, -1 = cache only.",
          })
        ),
      }),
      async execute(_id, params, signal) {
        const c = getExaConfig();
        return safeExecute(c.apiKey, () =>
          fetchUrls(c.apiKey, params as Record<string, unknown>, signal)
        );
      },
    });
  }

  // get_code_context_exa — code/docs via /context endpoint (deprecated, use web_search_exa)
  if (has("get_code_context_exa")) {
    pi.registerTool({
      name: "get_code_context_exa",
      label: "Code Search (Exa)",
      description:
        "Deprecated — use web_search_exa. Find code examples, API usage patterns, and programming solutions from GitHub, Stack Overflow, and official docs.",
      promptSnippet: "Deprecated — use web_search_exa",
      parameters: Type.Object({
        query: Type.String({
          description: "The code search query (e.g., 'Python async await example')",
        }),
        tokensNum: Type.Optional(
          Type.Union([Type.String(), Type.Integer()], {
            description: "Token limit: 'dynamic' (default) or a number (max 100000)",
          })
        ),
      }),
      async execute(_id, params, signal) {
        const c = getExaConfig();
        return safeExecute(c.apiKey, () =>
          contextSearch(c.apiKey, params as Record<string, unknown>, signal)
        );
      },
    });
  }

  // web_search_advanced_exa — full-featured search (opt-in)
  if (has("web_search_advanced_exa")) {
    pi.registerTool({
      name: "web_search_advanced_exa",
      label: "Advanced Web Search (Exa)",
      description:
        "Advanced web search with full control over search type, filters, domains, dates, content options, and structured outputs.",
      promptSnippet:
        "Advanced search with date filters, domain restrictions, or specific content types",
      parameters: Type.Object({
        query: Type.String({ description: "The search query" }),
        numResults: Type.Optional(
          Type.Integer({ description: "Number of results (default 10, max 100)" })
        ),
        maxCharacters: Type.Optional(
          Type.Integer({
            description: "Max chars of page text per result. Omit for highlights only.",
          })
        ),
        maxAgeHours: Type.Optional(
          Type.Integer({
            description: "Max cached age in hours. 0 = livecrawl, -1 = cache only.",
          })
        ),
        type: Type.Optional(
          Type.String({
            description: "Search type: auto, fast, instant, deep-lite, deep, deep-reasoning. Avoid deep types (expensive).",
          })
        ),
        category: Type.Optional(
          Type.String({
            description: "Content category: company, people, research paper, news, personal site, financial report.",
          })
        ),
        userLocation: Type.Optional(
          Type.String({ description: "Two-letter ISO country code (e.g., 'US')" })
        ),
        startPublishedDate: Type.Optional(
          Type.String({ description: "Start date filter (ISO 8601)" })
        ),
        endPublishedDate: Type.Optional(
          Type.String({ description: "End date filter (ISO 8601)" })
        ),
        includeDomains: Type.Optional(
          Type.String({ description: "Comma-separated domains to include" })
        ),
        excludeDomains: Type.Optional(
          Type.String({ description: "Comma-separated domains to exclude" })
        ),
        includeText: Type.Optional(
          Type.String({ description: "Comma-separated strings that must appear in the page text" })
        ),
        excludeText: Type.Optional(
          Type.String({ description: "Comma-separated strings that must not appear in the page text" })
        ),
        additionalQueries: Type.Optional(
          Type.String({ description: "Alternative query formulations (comma-separated, max 10)" })
        ),
        systemPrompt: Type.Optional(
          Type.String({ description: "Instructions guiding synthesized output" })
        ),
        outputSchema: Type.Optional(
          Type.String({
            description: "JSON schema for structured output",
          })
        ),
        moderation: Type.Optional(
          Type.Boolean({ description: "Moderate results for safety" })
        ),
        subpages: Type.Optional(
          Type.Integer({ description: "Subpages per result (0 disables)" })
        ),
        subpageTarget: Type.Optional(
          Type.String({ description: "Subpage source: 'sources', 'mentions'" })
        ),
        extrasLinks: Type.Optional(
          Type.Integer({ description: "External links to extract per result" })
        ),
        extrasImageLinks: Type.Optional(
          Type.Integer({ description: "Image links to extract per result" })
        ),
      }),
      async execute(_id, params, signal) {
        const c = getExaConfig();
        return safeExecute(c.apiKey, () =>
          search(c.apiKey, params as Record<string, unknown>, signal)
        );
      },
    });
  }

  // exa_answer — search + LLM answer in one call (opt-in)
  if (has("exa_answer")) {
    pi.registerTool({
      name: "exa_answer",
      label: "Answer (Exa)",
      description:
        "Get an LLM-generated answer to a question with citations from Exa search results. Combines search + generation in one call.",
      promptSnippet:
        "Generate a direct answer to a question using web search with citations",
      parameters: Type.Object({
        query: Type.String({
          description: "The question to answer",
        }),
        text: Type.Optional(
          Type.Boolean({
            description: "Include full text of search results used for the answer (default false)",
          })
        ),
      }),
      async execute(_id, params, signal) {
        const c = getExaConfig();
        return safeExecute(c.apiKey, () =>
          answer(c.apiKey, params as Record<string, unknown>, signal)
        );
      },
    });
  }
}

// ── Self-check: `NODE_PATH=<pi global node_modules> bun index.ts` ──────────
if (import.meta.main) {
  const cfg = getExaConfig();
  const enabled = cfg.tools ?? DEFAULT_TOOLS;
  const missing = enabled.filter((t) => !TOOL_GUIDE[t]);
  if (missing.length) throw new Error(`no guide row for: ${missing.join(",")}`);
  const guide = buildGuide(enabled);
  if (!enabled.every((t) => guide.includes(t))) {
    throw new Error("guide missing a tool row");
  }
  if (!cfg.tools) {
    // explicit tools can be anything; defaults must include the two core tools
    if (
      enabled.length !== 2 ||
      !enabled.includes("web_search_exa") ||
      !enabled.includes("web_fetch_exa")
    ) {
      throw new Error("bad default toolset");
    }
  }
  console.log(`[xi-exa] enabled: ${enabled.join(", ")}`);
  console.log(`[xi-exa] guide: ${guide.length} chars`);
  console.log("[xi-exa] OK");
}
