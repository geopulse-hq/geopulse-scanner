// GENERATED from GeoPulse src/server/adapters/types.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * EngineAdapter contract.
 *
 * Every AI engine integration (direct API or scraper) implements this
 * interface. Upper layers depend ONLY on these types — they never know
 * which engine is behind the call.
 *
 * Adding a new engine = create a new file in src/server/adapters/<name>.ts,
 * implement EngineAdapter, register it in engineManager.ts.
 */

import type { EngineName } from "../shims/appTypes";

// ─── Inputs ──────────────────────────────────────────────────────────────

export type QueryParams = {
  /** The natural-language question to ask. */
  prompt: string;
  /** ISO 3166-1 alpha-2 country code (e.g. "US", "CN", "GB"). */
  country: string;
  /** ISO 639-1 language code (e.g. "en", "zh", "es"). */
  language: string;
  /** Hard timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Optional system prompt override. Adapters use sensible defaults. */
  systemPrompt?: string;
  /**
   * Search requirement. "required" forces the engine's web search tool
   * where the API supports it (OpenAI tool_choice=required). Defaults to
   * "auto" for ad-hoc calls.
   */
  searchPolicy?: "required" | "auto" | "provider_default";
};

// ─── Outputs ─────────────────────────────────────────────────────────────

export type Citation = {
  /** Full URL the engine cited. */
  url: string;
  /** Hostname extracted from the URL (e.g. "stripe.com"). */
  domain: string;
  /** Page title if available from the engine response. */
  title?: string;
  /** Snippet of surrounding context if available. */
  snippet?: string;
  /** 1-based position in the engine's citation list. */
  position: number;
  /** Where in responseText the citation is attached, when the API says. */
  startIndex?: number;
  endIndex?: number;
  /**
   * How we know the answer cites it:
   *   structured_annotation — the API's own citation annotation (OpenAI url_citation)
   *   inline_marker         — a [n] marker in the answer pointing at the API's citation list (Perplexity)
   *   text_link             — a URL written in the answer text (fallback; not an official citation)
   */
  origin?: "structured_annotation" | "inline_marker" | "text_link";
};

/**
 * What we can show about how an answer was produced. Lightweight on
 * purpose — the full API JSON is not stored.
 */
export type SearchAudit = {
  provider: string;
  requestedModel: string;
  /** Model name the API reports it actually ran. */
  model: string;
  requestId?: string;
  responseId?: string;
  startedAt: string;
  searchPolicy: "required" | "auto" | "provider_default";
  /**
   * true    — the response contains a completed search call (OpenAI web_search_call)
   * false   — search was required but no completed search call came back
   * unknown — the API exposes no search log (Perplexity), or the record predates audits
   */
  searchExecuted: "true" | "false" | "unknown";
  searchCalls: Array<{ id?: string; status: string; queries: string[] }>;
  /** Plain statement of what retrieval evidence the API returned, if any. */
  retrievalNote?: string;
  /** Pages the search tool looked at (not the same as being cited). */
  sourceUrls: string[];
  /** Location hint we sent through the API's official field. */
  userLocation?: { country: string };
  usage?: Record<string, unknown>;
  costUsd: number;
  costBasis: "reported" | "computed_from_usage" | "estimate";
  costNote: string;
};

export type QueryResult = {
  /** The engine that produced this result. */
  engine: EngineName;
  /** Full text of the AI's response. */
  responseText: string;
  /** Citations extracted from the response. */
  citations: Citation[];
  /** Raw response from the engine API for debugging. Never expose to clients. */
  rawResponse: unknown;
  /** True if served from cache, false if a fresh API call. */
  cached: boolean;
  /** When this result was originally produced (not when served from cache). */
  queriedAt: Date;
  /** Optional millisecond timing for fresh queries. */
  durationMs?: number;
  /** Search evidence + usage + cost. Absent on legacy / cached rows. */
  audit?: SearchAudit;
};

// ─── Errors ──────────────────────────────────────────────────────────────

export class EngineError extends Error {
  constructor(
    public engine: EngineName,
    public code:
      | "missing_api_key"
      | "rate_limited"
      | "timeout"
      | "auth"
      | "bad_request"
      | "server_error"
      | "parse_error"
      | "budget_blocked"
      | "unknown",
    message: string,
    public httpStatus?: number,
    public retryable: boolean = false,
  ) {
    super(`[${engine}] ${code}: ${message}`);
    this.name = "EngineError";
  }
}

// ─── Adapter contract ────────────────────────────────────────────────────

export interface EngineAdapter {
  /** Stable engine identifier used throughout the app and as cache key. */
  readonly name: EngineName;

  /** Human-readable display name for UI. */
  readonly displayName: string;

  /** Fast availability check. Returns false if API key is missing or invalid. */
  isAvailable(): Promise<boolean>;

  /**
   * Run a single query against the engine.
   * Throws EngineError on failure (retryable flag tells caller whether to retry).
   */
  query(params: QueryParams): Promise<QueryResult>;
}

// ─── Helpers shared by adapters ──────────────────────────────────────────

/**
 * Extract a domain from a URL string. Returns empty string on parse failure.
 * Strips www. prefix.
 */
export function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Build a default system prompt that encourages citation behavior.
 * Adapters can override.
 */
/** Remove tracking parameters engines append (e.g. ?utm_source=openai). */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\?$/, "");
  } catch {
    return url;
  }
}

export function defaultSystemPrompt(language: string): string {
  if (language === "zh") {
    return "你是一个有用的研究助手。回答时请引用具体的来源 URL，每个 URL 单独成行，格式为 [n] https://...。";
  }
  return "You are a helpful research assistant. When answering, cite specific source URLs. Format citations as [n] https://... on their own lines.";
}
