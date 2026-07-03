/**
 * pi-exa — Web & code search via Exa API v1.2.0
 *
 * Provides four tools:
 *   web_search_exa        — basic web search
 *   get_code_context_exa  — find code examples/docs
 *   crawling_exa          — extract full content from a URL
 *   web_search_advanced_exa — advanced search with filters
 *
 * API reference: https://docs.exa.ai/reference/search
 * Changelog:     https://docs.exa.ai/reference/openapi-spec
 *
 * Last verified against API: 2026-04-30
 * Deprecations removed: startCrawlDate, endCrawlDate
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
  snippet?: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  text?: string;
  highlights?: string[];
}

interface CrawlResult {
  url: string;
  title?: string;
  text?: string;
  author?: string;
  publishedDate?: string;
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
    const { join, dirname } = require("node:path");
    const { fileURLToPath } = require("node:url");

    const extDir = dirname(fileURLToPath(import.meta.url));
    const configPath = join(extDir, "exa-config.json");
    const key = tryReadConfig(configPath);
    if (key) return { apiKey: key };
  } catch (err) {
    console.error("[pi-exa] Could not load config:", err);
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

// ── Formatting ─────────────────────────────────────────────────────────────

/**
 * Formats search results (from /search endpoint).
 * Exa returns results with title/url/snippet/text/highlights.
 * We produce a markdown list with links and content.
 */
function formatSearchResults(results: SearchResult[], responseData: Record<string, unknown>): string {
  if (!results.length) return "No results found.";

  const lines: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`### ${i + 1}. ${r.title}`);
    lines.push(`URL: ${r.url}`);

    if (r.score) lines.push(`Score: ${(r.score * 100).toFixed(1)}%`);
    if (r.publishedDate) lines.push(`Published: ${r.publishedDate}`);
    if (r.author) lines.push(`Author: ${r.author}`);

    if (r.highlights?.length) {
      lines.push("");
      lines.push(r.highlights.join("\n\n"));
    } else if (r.text) {
      lines.push("");
      lines.push(r.text);
    } else if (r.snippet) {
      lines.push("");
      lines.push(r.snippet);
    }

    if (i < results.length - 1) lines.push("\n---\n");
  }

  const text = lines.join("\n");

  if (responseData.requestsLeft !== undefined) {
    return `${text}\n\n*Requests remaining: ${responseData.requestsLeft}*`;
  }
  return text;
}

/**
 * Formats crawl results (from /contents endpoint).
 * Each result is a full page extraction.
 */
function formatCrawlResults(results: CrawlResult[]): string {
  if (!results.length) return "No content found.";

  return results
    .map((r) => {
      let block = `## ${r.title || r.url}\n`;
      block += `URL: ${r.url}\n`;
      if (r.author) block += `Author: ${r.author}\n`;
      if (r.publishedDate) block += `Published: ${r.publishedDate}\n`;
      block += `\n${r.text || "(no content)"}\n`;
      return block;
    })
    .join("\n---\n");
}

// ── Contents options builder ───────────────────────────────────────────────

/**
 * Builds the `contents` object for search requests.
 * When maxCharacters is provided, returns text with that limit + highlights.
 * When omitted, returns just highlights (lighter response).
 */
function buildContentsOpts(maxCharacters?: number): Record<string, unknown> {
  if (maxCharacters) {
    return {
      text: { maxCharacters },
      highlights: { maxCharacters: Math.min(maxCharacters, 4000) },
    };
  }
  return { highlights: true };
}

// ── Core operations ────────────────────────────────────────────────────────

async function search(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const body: Record<string, unknown> = {
    query: params.query,
    numResults: (params.numResults as number) || 10,
    contents: buildContentsOpts(params.maxCharacters as number | undefined),
  };

  // Optional filters
  if (params.type && params.type !== "auto") body.type = params.type;
  if (params.category) body.category = params.category;
  if (params.livecrawl) body.livecrawl = params.livecrawl;
  if (params.startPublishedDate) body.startPublishedDate = params.startPublishedDate;
  if (params.endPublishedDate) body.endPublishedDate = params.endPublishedDate;

  if (params.includeDomains) {
    body.includeDomains = String(params.includeDomains).split(",").map((d) => d.trim());
  }
  if (params.excludeDomains) {
    body.excludeDomains = String(params.excludeDomains).split(",").map((d) => d.trim());
  }

  const data = await exaPost(apiKey, "/search", body, signal);
  const results = data.results as SearchResult[] | undefined;
  const text = formatSearchResults(results || [], data);

  return { content: [{ type: "text", text }] };
}

async function crawl(
  apiKey: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const body: Record<string, unknown> = {
    urls: [params.url],
    text: { maxCharacters: (params.maxCharacters as number) || 10000 },
  };

  const data = await exaPost(apiKey, "/contents", body, signal);
  const results = data.results as CrawlResult[] | undefined;
  const text = formatCrawlResults(results || []);

  return { content: [{ type: "text", text }] };
}

// ── Safe execute wrapper ───────────────────────────────────────────────────

async function safeExecute(
  apiKey: string | null,
  fn: () => Promise<{ content: Array<{ type: "text"; text: string }> }>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (!apiKey) {
    return {
      content: [{
        type: "text",
        text: "Error: Exa API key not configured. Set EXA_API_KEY env var or create ~/.pi/agent/extensions/exa-config.json with {\"apiKey\": \"...\"}.",
      }],
    };
  }

  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pi-exa] Tool error:", err);
    return { content: [{ type: "text", text: `Error: ${message}` }] };
  }
}

// ── Extension ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const config = getExaConfig();

  // web_search_exa — basic web search (minimal params)
  pi.registerTool({
    name: "web_search_exa",
    label: "Web Search (Exa)",
    description:
      "Search the web for any topic and get clean, ready-to-use content with links to sources.",
    promptSnippet: "Search the web for current information, news, or topics needing up-to-date data",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
      numResults: Type.Optional(Type.Integer({
        description: "Number of results (default: 10, max: 100)"
      })),
      maxCharacters: Type.Optional(Type.Integer({
        description: "Max characters of page text to return per result. Omit for highlights only (lighter/cheaper)."
      })),
    }),
    async execute(_id, params, signal) {
      return safeExecute(config.apiKey, () => search(config.apiKey, params as Record<string, unknown>, signal));
    },
  });

  // get_code_context_exa — code/docs search
  pi.registerTool({
    name: "get_code_context_exa",
    label: "Code Search (Exa)",
    description:
      "Find code examples, documentation, and programming solutions from GitHub, Stack Overflow, and official docs.",
    promptSnippet: "Find code examples, API usage patterns, or programming documentation",
    parameters: Type.Object({
      query: Type.String({
        description: "The code search query (e.g., 'Python async await example')"
      }),
      maxCharacters: Type.Optional(Type.Integer({
        description: "Max characters of page text per result (default: 10000). Higher values return more context."
      })),
      numResults: Type.Optional(Type.Integer({
        description: "Number of results (default: 5)"
      })),
    }),
    async execute(_id, params, signal) {
      const p = { ...params, numResults: params.numResults || 5, maxCharacters: params.maxCharacters ?? 10000 };
      return safeExecute(config.apiKey, () => search(config.apiKey, p as Record<string, unknown>, signal));
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
      maxCharacters: Type.Optional(Type.Integer({
        description: "Max characters to return (default: 10000)"
      })),
    }),
    async execute(_id, params, signal) {
      return safeExecute(config.apiKey, () => crawl(config.apiKey, params as Record<string, unknown>, signal));
    },
  });

  // web_search_advanced_exa — full-featured search
  pi.registerTool({
    name: "web_search_advanced_exa",
    label: "Advanced Web Search (Exa)",
    description:
      "Advanced web search with full control over filters, domains, dates, and content options.",
    promptSnippet: "Advanced search with date filters, domain restrictions, or specific content types",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
      numResults: Type.Optional(Type.Integer({
        description: "Number of results (default: 10, max: 100)"
      })),
      maxCharacters: Type.Optional(Type.Integer({
        description: "Max characters of page text per result. Omit for highlights only."
      })),
      type: Type.Optional(Type.String({
        description: "Search type: 'auto' (default, intelligently combines methods), 'neural' (embeddings-based, best for concepts), 'fast' (streamlined, for quick answers), 'deep-reasoning' (synthesized output, best for research)"
      })),
      livecrawl: Type.Optional(Type.String({
        description: "Content freshness: 'fallback' (default), 'always', 'preferred', 'never'"
      })),
      category: Type.Optional(Type.String({
        description: "Content category: 'news', 'research paper'"
      })),
      startPublishedDate: Type.Optional(Type.String({
        description: "Start date filter (ISO 8601, e.g., '2024-01-01T00:00:00.000Z')"
      })),
      endPublishedDate: Type.Optional(Type.String({
        description: "End date filter (ISO 8601, e.g., '2024-12-31T00:00:00.000Z')"
      })),
      includeDomains: Type.Optional(Type.String({
        description: "Comma-separated list of domains to include"
      })),
      excludeDomains: Type.Optional(Type.String({
        description: "Comma-separated list of domains to exclude"
      })),
    }),
    async execute(_id, params, signal) {
      return safeExecute(config.apiKey, () => search(config.apiKey, params as Record<string, unknown>, signal));
    },
  });
}
