// GENERATED from GeoPulse src/server/adapters/openai.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * OpenAI adapter — Responses API with the web_search tool.
 *
 * With searchPolicy "required" the request sets tool_choice=required and
 * the result records whether a completed web_search_call actually came
 * back (searchExecuted). It never quietly falls back to an answer without
 * search: the caller sees searchExecuted=false and treats the answer as
 * "search not completed".
 *
 * Sources (pages the search tool looked at, via
 * include=web_search_call.action.sources) are kept apart from citations
 * (url_citation annotations the answer actually carries).
 *
 * Docs: https://developers.openai.com/api/docs/guides/tools-web-search
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
import { openAiCostUsd } from "../shims/aiSpend";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
// gpt-4o-mini with forced web search: ≈ $0.012 per answer (measured 2026-10-11).
export const MODEL = "gpt-4o-mini";
export const MAX_SEARCH_CALLS = 2;
export const MAX_OUTPUT_TOKENS = 2000;

// ─── Response shape (subset we care about) ──────────────────────────────

export type OpenAIResponseOutput = {
  type: string; // "message" | "web_search_call" | etc.
  id?: string;
  status?: string;
  action?: {
    type?: string;
    query?: string;
    queries?: string[];
    sources?: Array<{ type?: string; url?: string }>;
  };
  content?: Array<{
    type: string; // "output_text" | "text" | etc.
    text?: string;
    annotations?: Array<{
      type: string; // "url_citation"
      url?: string;
      title?: string;
      start_index?: number;
      end_index?: number;
    }>;
  }>;
};

export type OpenAIResponse = {
  id: string;
  model?: string;
  status?: string;
  output?: OpenAIResponseOutput[];
  output_text?: string; // convenience field
  error?: { message: string; type: string };
  usage?: { input_tokens?: number; output_tokens?: number };
};

// ─── Adapter ────────────────────────────────────────────────────────────

export const openaiAdapter: EngineAdapter = {
  name: "openai",
  displayName: "OpenAI API",

  async isAvailable() {
    return !!env.OPENAI_API_KEY();
  },

  async query(params: QueryParams): Promise<QueryResult> {
    const apiKey = env.OPENAI_API_KEY();
    if (!apiKey) {
      throw new EngineError("openai", "missing_api_key", "OPENAI_API_KEY not set");
    }

    const start = Date.now();
    const timeout = params.timeoutMs ?? 30000;

    const searchPolicy = params.searchPolicy ?? "auto";
    const country = params.country.toUpperCase();
    const startedAt = new Date().toISOString();
    const body = {
      model: MODEL,
      input: [
        {
          role: "system",
          content: params.systemPrompt ?? defaultSystemPrompt(params.language),
        },
        { role: "user", content: params.prompt },
      ],
      // Country goes through the tool's official user_location field.
      tools: [{ type: "web_search", user_location: { type: "approximate", country } }],
      tool_choice: searchPolicy === "required" ? "required" : "auto",
      // Bounds that make the per-call budget reservation an upper limit
      // (see RESERVE_USD in protocol.ts).
      max_tool_calls: MAX_SEARCH_CALLS,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      include: ["web_search_call.action.sources"],
      // Record only — metadata does not influence search.
      metadata: { country, language: params.language },
    };

    const response = await (
      async () => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeout);
        try {
          const res = await fetch(OPENAI_RESPONSES_URL, {
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
              "openai",
              code,
              text.slice(0, 500),
              res.status,
              code === "rate_limited" || code === "server_error",
            );
          }
          const json = (await res.json()) as OpenAIResponse;
          return { json, requestId: res.headers.get("x-request-id") ?? undefined };
        } catch (err) {
          if (err instanceof EngineError) throw err;
          if ((err as Error).name === "AbortError") {
            throw new EngineError("openai", "timeout", `Request exceeded ${timeout}ms`, undefined, true);
          }
          throw new EngineError("openai", "unknown", (err as Error).message, undefined, true);
        } finally {
          clearTimeout(t);
        }
      }
    )(); // One attempt only: retries happen in engineManager, each with its own budget reservation.

    const { json: data, requestId } = response;
    if (data.error) {
      throw new EngineError("openai", "server_error", data.error.message);
    }

    // Extract text + citations
    const { responseText, citations } = parseOpenAIResponse(data);
    const audit = buildOpenAIAudit(data, { requestId, startedAt, searchPolicy, country });

    return {
      engine: "openai",
      responseText,
      citations,
      rawResponse: null,
      cached: false,
      queriedAt: new Date(),
      durationMs: Date.now() - start,
      audit,
    };
  },
};

// ─── Audit ──────────────────────────────────────────────────────────────

const SEARCH_CALL_USD = 0.01;

/**
 * Search evidence + cost for one response.
 *
 * Cost: gpt-4o-mini text tokens from `usage`, plus $0.01 per web_search
 * call. For gpt-4o-mini the search content is billed as a fixed block of
 * 8,000 input tokens per call; a probe on 2026-10-11 returned
 * input_tokens=8,540 for a ~70-token prompt, i.e. `usage` already
 * includes that block, so it is not added a second time.
 */
export function buildOpenAIAudit(
  data: OpenAIResponse,
  ctx: { requestId?: string; startedAt: string; searchPolicy: SearchAudit["searchPolicy"]; country: string },
): SearchAudit {
  const calls = (data.output ?? []).filter((o) => o.type === "web_search_call");
  const searchCalls = calls.map((c) => ({
    id: c.id,
    status: c.status ?? "unknown",
    queries: [...new Set([...(c.action?.queries ?? []), ...(c.action?.query ? [c.action.query] : [])])],
  }));
  const completed = searchCalls.some((c) => c.status === "completed");
  const sourceUrls = [
    ...new Set(calls.flatMap((c) => (c.action?.sources ?? []).map((src) => (src.url ? cleanUrl(src.url) : ""))).filter(Boolean)),
  ];
  const inTok = data.usage?.input_tokens ?? 0;
  const outTok = data.usage?.output_tokens ?? 0;
  return {
    provider: "openai",
    requestedModel: MODEL,
    model: data.model ?? MODEL,
    requestId: ctx.requestId,
    responseId: data.id,
    startedAt: ctx.startedAt,
    searchPolicy: ctx.searchPolicy,
    searchExecuted: completed ? "true" : ctx.searchPolicy === "required" ? "false" : calls.length ? "false" : "unknown",
    searchCalls,
    sourceUrls,
    userLocation: { country: ctx.country },
    usage: data.usage as Record<string, unknown> | undefined,
    costUsd: openAiCostUsd(inTok, outTok, calls.length),
    costBasis: "computed_from_usage",
    costNote: `${inTok} in × $0.15/M + ${outTok} out × $0.60/M + ${calls.length} search call(s) × $${SEARCH_CALL_USD}; usage already includes the 8,000-token search block`,
  };
}

// ─── Parser ─────────────────────────────────────────────────────────────

export function parseOpenAIResponse(data: OpenAIResponse): {
  responseText: string;
  citations: Citation[];
} {
  // Prefer the convenience field
  let responseText = data.output_text ?? "";
  const citationMap = new Map<string, Citation>();

  // Walk output[*].content[*] to extract text + url_citation annotations
  for (const out of data.output ?? []) {
    if (out.type !== "message") continue;
    for (const c of out.content ?? []) {
      if (c.type === "output_text" || c.type === "text") {
        if (!responseText && c.text) responseText = c.text;
        for (const ann of c.annotations ?? []) {
          const url = ann.url ? cleanUrl(ann.url) : "";
          if (ann.type === "url_citation" && url && !citationMap.has(url)) {
            citationMap.set(url, {
              url,
              domain: extractDomain(url),
              title: ann.title,
              position: citationMap.size + 1,
              startIndex: ann.start_index,
              endIndex: ann.end_index,
              origin: "structured_annotation",
            });
          }
        }
      }
    }
  }

  // Fallback: no annotations — URLs written in the text, marked as such.
  if (citationMap.size === 0 && responseText) {
    const urlRe = /https?:\/\/[^\s\])>"']+/g;
    let pos = 1;
    for (const match of responseText.matchAll(urlRe)) {
      const url = cleanUrl(match[0].replace(/[.,;:)\]}]+$/, ""));
      if (!citationMap.has(url)) {
        citationMap.set(url, {
          url,
          domain: extractDomain(url),
          position: pos++,
          startIndex: match.index,
          endIndex: (match.index ?? 0) + match[0].length,
          origin: "text_link",
        });
      }
    }
  }

  return {
    responseText,
    citations: Array.from(citationMap.values()),
  };
}
