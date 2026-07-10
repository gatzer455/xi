/**
 * xi-exa — Web & code search via Exa API v2.0.0
 *
 * Provides up to five tools:
 *   web_search_exa         — basic web search
 *   get_code_context_exa   — find code examples via /context endpoint
 *   crawling_exa           — extract full content from a URL
 *   web_search_advanced_exa — advanced search with full filters
 *   exa_answer             — search + LLM-generated answer with citations
 *
 * API reference: https://exa.ai/docs/reference/search-api-guide-for-coding-agents
 * Code search:   https://exa.ai/docs/reference/context
 * Contents:      https://exa.ai/docs/reference/contents-api-guide-for-coding-agents
 * Answer:        https://exa.ai/docs/reference/answer
 *
 * Last verified against API: 2026-07-10
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── Types ──────────────────────────────────────────────────────────────────

interface ExaConfig {
  apiKey: string | null;
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

function tryReadConfig(filePath: string): string | null {
  try {
    const { readFileSync } = require("node:fs");
    return JSON.parse(readFileSync(filePath, "utf8")).apiKey || null;
  } catch {
    return null;
  }
}

function getExaConfig(): ExaConfig {
  const envKey = process.env.EXA_API_KEY;
  if (envKey) return { apiKey: envKey };

  try {
    const { homedir } = require("node:os");
    const { join } = require("node:path");

    // 1. Central config (~/.pi/config/exa-config.json)
    const centralPath = join(homedir(), ".pi", "config", "exa-config.json");
    const key = tryReadConfig(centralPath);
    if (key) return { apiKey: key };

    // 2. Fallback: extension dir (legacy)
    const { dirname } = require("node:path");
    const { fileURLToPath } = require("node:url");
    const extDir = dirname(fileURLToPath(import.meta.url));
    const extPath = join(extDir, "exa-config.json");
    const legacyKey = tryReadConfig(extPath);
    if (legacyKey) return { apiKey: legacyKey };
  } catch (err) {
    console.error("[xi-exa] Could not load config:", err);
  }

  return { apiKey: null };
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

async function search(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
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

  return { content: [{ type: "text", text }] };
}

async function contextSearch(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const body: Record<string, unknown> = {
    query: params.query,
    tokensNum: (params.tokensNum as number | string) ?? "dynamic",
  };

  const data = await exaPost(apiKey, "/context", body, signal);
  const text = formatContextResults(data);

  return { content: [{ type: "text", text }] };
}

async function crawl(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const maxChars = (params.maxCharacters as number) ?? 10000;
  const body: Record<string, unknown> = {
    urls: [params.url],
    text: { maxCharacters: maxChars },
  };

  if (params.maxAgeHours !== undefined) {
    body.maxAgeHours = params.maxAgeHours;
  }

  const data = await exaPost(apiKey, "/contents", body, signal);
  const results = data.results as CrawlResult[] | undefined;
  const text = formatCrawlResults(results || []);

  return { content: [{ type: "text", text }] };
}

async function answer(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const body: Record<string, unknown> = {
    query: params.query,
  };

  if (params.text) body.text = params.text;

  const data = await exaPost(apiKey, "/answer", body, signal);
  const text = formatAnswerResults(data);

  return { content: [{ type: "text", text }] };
}

// ── Safe execute wrapper ───────────────────────────────────────────────────

async function safeExecute(
  apiKey: string | null,
  fn: () => Promise<{ content: Array<{ type: "text"; text: string }> }>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (!apiKey) {
    return {
      content: [
        {
          type: "text",
          text: "Error: Exa API key not configured. Set EXA_API_KEY env var or add it in Settings.",
        },
      ],
    };
  }

  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[xi-exa] Tool error:", err);
    return { content: [{ type: "text", text: `Error: ${message}` }] };
  }
}

// ── Extension ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Usage guidance injected at session start ──────────────────────
  pi.on("session_start", () => {
    pi.sendMessage(
      {
        customType: "xi-exa-guidance",
        content: `## Exa Search Tools — Usage Guide

Prefer the cheapest tool for each task. Avoid expensive deep search unless necessary.

| Tool | Best for | Cost |
|------|----------|------|
| \`get_code_context_exa\` | Code examples, API docs, programming solutions | **Cheapest** — specialized code index |
| \`web_search_exa\` | General web search, current events, factual info | Low — highlights only by default |
| \`crawling_exa\` | Extract full content from a **specific URL** you already have | Low |
| \`exa_answer\` | Direct answer to a question with citations (search + LLM generation) | Medium — includes LLM cost |
| \`web_search_advanced_exa\` | Complex filtered search with date/domain/category filters | **Variable — avoid deep/deep-reasoning unless essential** (12-40s, expensive) |

**Rules of thumb:**
- For code questions → always \`get_code_context_exa\` (it searches GitHub, Stack Overflow, docs)
- For general knowledge → \`web_search_exa\` with highlights (omit maxCharacters for cheapest)
- For a specific URL → \`crawling_exa\`
- For "what is X?" questions → \`exa_answer\` (gets you a direct answer, not just links)
- Only use \`web_search_advanced_exa\` when you need date filters, specific domains, or structured output
- **NEVER use type=\"deep\" or type=\"deep-reasoning\" unless the user explicitly asks for deep research**`,
        display: false,
      },
      { deliverAs: "steer" }
    );
  });

  // web_search_exa — basic web search
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
        Type.Integer({
          description: "Number of results (default: 10, max: 100)",
        })
      ),
      maxCharacters: Type.Optional(
        Type.Integer({
          description:
            "Max characters of page text to return per result. Omit for highlights only (lighter/cheaper).",
        })
      ),
      maxAgeHours: Type.Optional(
        Type.Integer({
          description:
            "Max age of cached content in hours. 0 = always livecrawl, -1 = never livecrawl. Omit for default (fallback to livecrawl).",
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

  // get_code_context_exa — code/docs via /context endpoint
  pi.registerTool({
    name: "get_code_context_exa",
    label: "Code Search (Exa)",
    description:
      "Find code examples, API usage patterns, and programming solutions from GitHub, Stack Overflow, and official docs. Uses Exa's /context endpoint optimized for coding agents.",
    promptSnippet:
      "Find code examples, API usage patterns, or programming documentation",
    parameters: Type.Object({
      query: Type.String({
        description:
          "The code search query (e.g., 'Python async await example')",
      }),
      tokensNum: Type.Optional(
        Type.Union([Type.String(), Type.Integer()], {
          description:
            "Token limit for the response. 'dynamic' (default, auto-optimize), or specific number (e.g., 5000). Max 100000.",
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

  // crawling_exa — extract URL content
  pi.registerTool({
    name: "crawling_exa",
    label: "Crawl URL (Exa)",
    description:
      "Get the full content of a specific webpage from a known URL. Use this when you have a specific link to extract.",
    promptSnippet: "Extract full content from a specific URL or webpage",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to crawl" }),
      maxCharacters: Type.Optional(
        Type.Integer({
          description: "Max characters to return (default: 10000)",
        })
      ),
      maxAgeHours: Type.Optional(
        Type.Integer({
          description:
            "Max age of cached content in hours. 0 = always livecrawl, -1 = cache only. Omit for default.",
        })
      ),
    }),
    async execute(_id, params, signal) {
      const c2 = getExaConfig();
      return safeExecute(c2.apiKey, () =>
        crawl(c2.apiKey, params as Record<string, unknown>, signal)
      );
    },
  });

  // web_search_advanced_exa — full-featured search
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
        Type.Integer({
          description: "Number of results (default: 10, max: 100)",
        })
      ),
      maxCharacters: Type.Optional(
        Type.Integer({
          description:
            "Max characters of page text per result. Omit for highlights only.",
        })
      ),
      maxAgeHours: Type.Optional(
        Type.Integer({
          description:
            "Max age of cached content in hours. 0 = always livecrawl, -1 = never livecrawl. Omit for default.",
        })
      ),
      type: Type.Optional(
        Type.String({
          description:
            "Search type: 'auto' (default, balance of speed/quality), 'fast' (low latency), 'instant' (lowest latency, ~250ms), 'deep-lite' (lightweight synthesized), 'deep' (multi-step research), 'deep-reasoning' (maximum reasoning).",
        })
      ),
      category: Type.Optional(
        Type.String({
          description:
            "Content category: 'company', 'people', 'research paper', 'news', 'personal site', 'financial report'.",
        })
      ),
      userLocation: Type.Optional(
        Type.String({
          description:
            "Two-letter ISO country code of the user (e.g., 'US').",
        })
      ),
      startPublishedDate: Type.Optional(
        Type.String({
          description:
            "Start date filter (ISO 8601, e.g., '2024-01-01T00:00:00.000Z')",
        })
      ),
      endPublishedDate: Type.Optional(
        Type.String({
          description:
            "End date filter (ISO 8601, e.g., '2024-12-31T00:00:00.000Z')",
        })
      ),
      includeDomains: Type.Optional(
        Type.String({
          description: "Comma-separated list of domains to include",
        })
      ),
      excludeDomains: Type.Optional(
        Type.String({
          description: "Comma-separated list of domains to exclude",
        })
      ),
      includeText: Type.Optional(
        Type.String({
          description:
            "Comma-separated list of strings that must appear in the page text",
        })
      ),
      excludeText: Type.Optional(
        Type.String({
          description:
            "Comma-separated list of strings that must not appear in the page text",
        })
      ),
      additionalQueries: Type.Optional(
        Type.String({
          description:
            "Alternative query formulations for deep search. JSON array or comma-separated. Max 10 queries.",
        })
      ),
      systemPrompt: Type.Optional(
        Type.String({
          description:
            "Instructions that guide synthesized output and search planning. Supported on all search types.",
        })
      ),
      outputSchema: Type.Optional(
        Type.String({
          description:
            "JSON schema for structured synthesized output. Use '{\"type\":\"text\",\"description\":\"...\"}' for plain text or '{\"type\":\"object\",\"properties\":{...}}' for JSON. Supported on all search types.",
        })
      ),
      moderation: Type.Optional(
        Type.Boolean({
          description:
            "If true, search results are moderated for safety",
        })
      ),
      subpages: Type.Optional(
        Type.Integer({
          description: "Number of subpages to include per result (0 to disable)",
        })
      ),
      subpageTarget: Type.Optional(
        Type.String({
          description: "Where subpages are sourced: 'sources', 'mentions'",
        })
      ),
      extrasLinks: Type.Optional(
        Type.Integer({
          description: "Number of external links to extract per result",
        })
      ),
      extrasImageLinks: Type.Optional(
        Type.Integer({
          description: "Number of image links to extract per result",
        })
      ),
    }),
    async execute(_id, params, signal) {
      const c3 = getExaConfig();
      return safeExecute(c3.apiKey, () =>
        search(c3.apiKey, params as Record<string, unknown>, signal)
      );
    },
  });

  // exa_answer — search + LLM answer in one call
  pi.registerTool({
    name: "exa_answer",
    label: "Answer (Exa)",
    description:
      "Get an LLM-generated answer to a question with citations from Exa search results. Combines search + generation in one call.",
    promptSnippet:
      "Generate a direct answer to a question using web search with citations",
    parameters: Type.Object({
      query: Type.String({
        description: "The question to answer (e.g., 'What is the latest valuation of SpaceX?')",
      }),
      text: Type.Optional(
        Type.Boolean({
          description:
            "If true, includes full text of search results used for the answer (default: false)",
        })
      ),
    }),
    async execute(_id, params, signal) {
      const c4 = getExaConfig();
      return safeExecute(c4.apiKey, () =>
        answer(c4.apiKey, params as Record<string, unknown>, signal)
      );
    },
  });
}
