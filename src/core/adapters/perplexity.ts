// GENERATED from GeoPulse src/server/adapters/perplexity.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Perplexity adapter — sonar (retrieval is built into the model).
 *
 * Docs: https://docs.perplexity.ai/api-reference/chat-completions-post
 *
 * Sources vs citations: `search_results` / `citations` list what the
 * retrieval step returned. Only entries the answer points at with an
 * inline [n] marker count as cited. The API exposes no search-tool log,
 * so searchExecuted is "unknown"; the number of retrieval results is
 * recorded as a plain note.
 */

import {
  type EngineAdapter,
  type QueryParams,
  type QueryResult,
  type Citation,
  type SearchAudit,
  EngineError,
  extractDomain,
  cleanUrl,
  defaultSystemPrompt,
} from "./types";
import { env } from "../shims/env";

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
export const MODEL = "sonar";
export const MAX_OUTPUT_TOKENS = 1024;

// ─── Response shape ─────────────────────────────────────────────────────

export type PerplexityResponse = {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: "assistant";
      content: string;
    };
  }>;
  citations?: string[]; // array of URLs in cited order (1-based by index in [1] [2] markers)
  search_results?: Array<{
    title: string;
    url: string;
    date?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    search_context_size?: string;
    cost?: { total_cost?: number; request_cost?: number; input_tokens_cost?: number; output_tokens_cost?: number };
  };
  error?: { message: string; type: string };
};

// ─── Adapter ────────────────────────────────────────────────────────────

export const perplexityAdapter: EngineAdapter = {
  name: "perplexity",
  displayName: "Perplexity",

  async isAvailable() {
    return !!env.PERPLEXITY_API_KEY();
  },

  async query(params: QueryParams): Promise<QueryResult> {
    const apiKey = env.PERPLEXITY_API_KEY();
    if (!apiKey) {
      throw new EngineError("perplexity", "missing_api_key", "PERPLEXITY_API_KEY not set");
    }

    const start = Date.now();
    const timeout = params.timeoutMs ?? 30000;

    const country = params.country.toUpperCase();
    const startedAt = new Date().toISOString();
    const body = {
      model: MODEL,
      messages: [
        {
          role: "system",
          content: params.systemPrompt ?? defaultSystemPrompt(params.language),
        },
        { role: "user", content: params.prompt },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      top_p: 0.9,
      // Fixed low search context keeps the request fee at its lowest tier,
      // so the per-call reservation is an upper bound (protocol.ts).
      web_search_options: { user_location: { country }, search_context_size: "low" },
    };

    const data = await (
      async () => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeout);
        try {
          const res = await fetch(PERPLEXITY_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (!res.ok) {
            const text = await res.text();
            const code: EngineError["code"] =
              res.status === 401
                ? "auth"
                : res.status === 429
                  ? "rate_limited"
                  : res.status >= 500
                    ? "server_error"
                    : "bad_request";
            throw new EngineError(
              "perplexity",
              code,
              text.slice(0, 500),
              res.status,
              code === "rate_limited" || code === "server_error",
            );
          }
          return (await res.json()) as PerplexityResponse;
        } catch (err) {
          if (err instanceof EngineError) throw err;
          if ((err as Error).name === "AbortError") {
            throw new EngineError("perplexity", "timeout", `Request exceeded ${timeout}ms`, undefined, true);
          }
          throw new EngineError("perplexity", "unknown", (err as Error).message, undefined, true);
        } finally {
          clearTimeout(t);
        }
      }
    )(); // One attempt only: retries happen in engineManager, each with its own budget reservation.

    if (data.error) {
      throw new EngineError("perplexity", "server_error", data.error.message);
    }

    const { responseText, citations, sourceUrls } = parsePerplexityResponse(data);

    return {
      engine: "perplexity",
      responseText,
      citations,
      rawResponse: null,
      cached: false,
      queriedAt: new Date(),
      durationMs: Date.now() - start,
      audit: buildPerplexityAudit(data, sourceUrls, { startedAt, country }),
    };
  },
};

// ─── Audit ──────────────────────────────────────────────────────────────

const ESTIMATE_USD = 0.006;

export function buildPerplexityAudit(
  data: PerplexityResponse,
  sourceUrls: string[],
  ctx: { startedAt: string; country: string },
): SearchAudit {
  const reported = data.usage?.cost?.total_cost;
  return {
    provider: "perplexity",
    requestedModel: MODEL,
    model: data.model ?? MODEL,
    responseId: data.id,
    startedAt: ctx.startedAt,
    searchPolicy: "provider_default",
    searchExecuted: "unknown",
    searchCalls: [],
    retrievalNote: `API returned ${sourceUrls.length} retrieval result(s); no search-tool log is exposed`,
    sourceUrls,
    userLocation: { country: ctx.country },
    usage: data.usage as Record<string, unknown> | undefined,
    costUsd: typeof reported === "number" ? reported : ESTIMATE_USD,
    costBasis: typeof reported === "number" ? "reported" : "estimate",
    costNote:
      typeof reported === "number"
        ? "usage.cost.total_cost returned by the API"
        : `API returned no cost; estimated at $${ESTIMATE_USD} (average of measured sonar requests, ±50%)`,
  };
}

// ─── Parser ─────────────────────────────────────────────────────────────

/**
 * citations: only entries the answer references with an inline [n] marker.
 * sourceUrls: everything retrieval returned.
 */
export function parsePerplexityResponse(data: PerplexityResponse): {
  responseText: string;
  citations: Citation[];
  sourceUrls: string[];
} {
  const responseText = (data.choices?.[0]?.message?.content ?? "").trim();

  // The numbered list the [n] markers point into.
  const numbered: Array<{ url: string; title?: string }> = data.citations?.length
    ? data.citations.map((url) => ({ url, title: data.search_results?.find((r) => r.url === url)?.title }))
    : (data.search_results ?? []).map((r) => ({ url: r.url, title: r.title }));

  const sourceUrls = [
    ...new Set([...numbered.map((n) => n.url), ...(data.search_results ?? []).map((r) => r.url)].map(cleanUrl)),
  ];

  const firstMarker = new Map<number, number>();
  for (const m of responseText.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (!firstMarker.has(n)) firstMarker.set(n, m.index ?? 0);
  }

  const citationMap = new Map<string, Citation>();
  for (const [n, at] of [...firstMarker.entries()].sort((a, b) => a[0] - b[0])) {
    const entry = numbered[n - 1];
    if (!entry) continue;
    const url = cleanUrl(entry.url);
    if (citationMap.has(url)) continue;
    citationMap.set(url, {
      url,
      domain: extractDomain(url),
      title: entry.title,
      position: n,
      startIndex: at,
      origin: "inline_marker",
    });
  }

  return { responseText, citations: [...citationMap.values()], sourceUrls };
}
