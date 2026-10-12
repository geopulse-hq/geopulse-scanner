/**
 * Run one scan: every question × every engine × SAMPLES_PER_PROMPT samples,
 * under GeoPulse detection protocol v1 (see docs/how-it-works.md).
 *
 * Each request carries only the question and the neutral, versioned system
 * instructions — never the brand, domain, competitors or earlier answers.
 * The answers are read afterwards with the same rules GeoPulse Cloud uses.
 */
import { openaiAdapter } from "./core/adapters/openai";
import { perplexityAdapter } from "./core/adapters/perplexity";
import { EngineError, type EngineAdapter, type QueryResult } from "./core/adapters/types";
import {
  FULL_REPORT_ENGINES,
  MAX_ATTEMPTS,
  RESERVE_USD,
  SAMPLES_PER_PROMPT,
  SYSTEM_PROMPT_VERSION,
  systemPromptFor,
  type EngineProtocol,
  type PromptIntent,
} from "./core/services/protocol";
import { enrichResult } from "./core/services/resultEnricher";
import type { ScanConfig } from "./config";

export const TOOL_VERSION = "0.1.0";

export type AnswerStatus = "ok" | "search_not_executed" | "error" | "not_run";

export type AnswerRecord = {
  questionIndex: number;
  question: string;
  intent: PromptIntent;
  engine: string;
  engineLabel: string;
  requestedModel: string;
  /** The model the API reports it actually ran. */
  model: string | null;
  sample: number;
  status: AnswerStatus;
  error?: { code: string; message: string };
  searchExecuted: "true" | "false" | "unknown" | null;
  responseText: string;
  citations: Array<{ url: string; domain: string; owned: boolean; category: string; origin: string | null }>;
  named: boolean;
  cited: boolean;
  recommended: boolean;
  negative: boolean;
  /** negative | recommended | mentioned | cited | null */
  mentionType: string | null;
  recommendationRule: string | null;
  recommendationSnippet: string | null;
  answerFit: string | null;
  competitorsNamed: string[];
  competitorsRecommended: string[];
  costUsd: number;
  queriedAt: string | null;
};

export type ScanResult = {
  tool: { name: "geopulse-scanner"; version: string };
  protocol: {
    version: "v1";
    systemPromptVersion: string;
    samplesPerQuestion: number;
    engines: Array<Pick<EngineProtocol, "engine" | "model" | "searchPolicy" | "label">>;
  };
  config: ScanConfig;
  startedAt: string;
  finishedAt: string;
  costUsd: number;
  /** Demo reports are built from fictitious sample answers, not API calls. */
  demo: boolean;
  answers: AnswerRecord[];
};

const ADAPTERS: Record<string, EngineAdapter> = { openai: openaiAdapter, perplexity: perplexityAdapter };

/** English labels for the report (the app's own labels are localized elsewhere). */
const ENGINE_LABELS: Record<string, string> = {
  openai: "OpenAI API · gpt-4o-mini · web search required",
  perplexity: "Perplexity API · sonar",
};

export type PlannedCall = { questionIndex: number; engine: EngineProtocol; sample: number };

export function planCalls(config: ScanConfig, engines: EngineProtocol[] = FULL_REPORT_ENGINES, samples = SAMPLES_PER_PROMPT): PlannedCall[] {
  const calls: PlannedCall[] = [];
  config.questions.forEach((_, questionIndex) => {
    for (const engine of engines) for (let sample = 1; sample <= samples; sample++) calls.push({ questionIndex, engine, sample });
  });
  return calls;
}

/** Upper-end estimate used to warn before spending — not a guaranteed ceiling. */
export function estimateUsd(calls: PlannedCall[]): number {
  return calls.reduce((s, c) => s + (RESERVE_USD[c.engine.engine] ?? 0.03), 0);
}

export function engineLabel(engine: string): string {
  return ENGINE_LABELS[engine] ?? engine;
}

/** Read one answer with the shared rules and flatten it for the report. */
export function toRecord(config: ScanConfig, call: PlannedCall, result: QueryResult): AnswerRecord {
  const q = config.questions[call.questionIndex]!;
  const enriched = enrichResult(result, {
    brand: { name: config.brand.name, aliases: config.brand.aliases, domain: config.brand.domain, ownedDomains: config.brand.ownedDomains },
    competitors: config.competitors,
    intent: q.intent,
  });
  const searchMissing = call.engine.searchPolicy === "required" && result.audit?.searchExecuted !== "true";
  const competitorsNamed = [...new Set(enriched.competitorMentions.map((m) => m.competitorName))];
  return {
    questionIndex: call.questionIndex,
    question: q.text,
    intent: q.intent,
    engine: call.engine.engine,
    engineLabel: engineLabel(call.engine.engine),
    requestedModel: call.engine.model,
    model: result.audit?.model ?? null,
    sample: call.sample,
    status: searchMissing ? "search_not_executed" : "ok",
    searchExecuted: result.audit?.searchExecuted ?? null,
    responseText: result.responseText,
    citations: enriched.classifiedCitations.map((c) => ({
      url: c.url,
      domain: c.domain,
      owned: c.isOwned,
      category: c.domainCategory,
      origin: c.origin ?? null,
    })),
    named: enriched.brandMentions.length > 0,
    cited: enriched.ownedCited,
    recommended: enriched.mentionType === "recommended",
    negative: enriched.mentionType === "negative",
    mentionType: enriched.mentionType,
    recommendationRule: enriched.recommendation.rule,
    recommendationSnippet: enriched.recommendation.snippet,
    answerFit: enriched.answerFit,
    competitorsNamed,
    competitorsRecommended: Object.entries(enriched.competitorRecommendations)
      .filter(([, r]) => r.recommended)
      .map(([name]) => name),
    costUsd: result.audit?.costUsd ?? 0,
    queriedAt: result.queriedAt ? new Date(result.queriedAt).toISOString() : null,
  };
}

/**
 * Error text can echo request headers (Node does, for an invalid header) —
 * never let an API key reach report.json / report.html.
 */
export function redactSecrets(message: string): string {
  let out = message;
  for (const k of ["OPENAI_API_KEY", "PERPLEXITY_API_KEY"]) {
    const v = process.env[k];
    if (v && v.length >= 8) out = out.split(v).join("[redacted]");
  }
  return out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|pplx-[A-Za-z0-9]{8,})/g, "[redacted]").replace(/Bearer\s+\S+/g, "Bearer [redacted]");
}

function failedRecord(config: ScanConfig, call: PlannedCall, status: AnswerStatus, code: string, rawMessage: string): AnswerRecord {
  const q = config.questions[call.questionIndex]!;
  const message = redactSecrets(rawMessage);
  return {
    questionIndex: call.questionIndex,
    question: q.text,
    intent: q.intent,
    engine: call.engine.engine,
    engineLabel: engineLabel(call.engine.engine),
    requestedModel: call.engine.model,
    model: null,
    sample: call.sample,
    status,
    error: { code, message },
    searchExecuted: null,
    responseText: "",
    citations: [],
    named: false,
    cited: false,
    recommended: false,
    negative: false,
    mentionType: null,
    recommendationRule: null,
    recommendationSnippet: null,
    answerFit: null,
    competitorsNamed: [],
    competitorsRecommended: [],
    costUsd: 0,
    queriedAt: null,
  };
}

export type RunOptions = {
  maxUsd: number;
  concurrency?: number;
  onProgress?: (done: number, total: number, last: AnswerRecord) => void;
};

export async function runScan(config: ScanConfig, opts: RunOptions): Promise<ScanResult> {
  const calls = planCalls(config);
  const startedAt = new Date().toISOString();
  const answers: AnswerRecord[] = new Array(calls.length);
  let spent = 0;
  let reserved = 0;
  let next = 0;
  let done = 0;

  const one = async (i: number) => {
    const call = calls[i]!;
    const q = config.questions[call.questionIndex]!;
    const adapter = ADAPTERS[call.engine.engine];
    const reserve = RESERVE_USD[call.engine.engine] ?? 0.03;
    let record: AnswerRecord;
    if (!adapter || !(await adapter.isAvailable())) {
      record = failedRecord(config, call, "not_run", "missing_api_key", `No API key for ${call.engine.engine} — set it in .env`);
    } else if (spent + reserved + reserve > opts.maxUsd) {
      record = failedRecord(config, call, "not_run", "budget", `Stopped: --max-usd ${opts.maxUsd} reached`);
    } else {
      reserved += reserve;
      record = failedRecord(config, call, "error", "unknown", "no attempt made");
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const result = await adapter.query({
            prompt: q.text,
            country: config.market.country,
            language: config.market.language,
            systemPrompt: systemPromptFor(q.intent, config.market.language, SYSTEM_PROMPT_VERSION),
            searchPolicy: call.engine.searchPolicy,
            timeoutMs: 60_000,
          });
          record = toRecord(config, call, result);
          spent += record.costUsd;
          break;
        } catch (err) {
          const e = err as EngineError;
          record = failedRecord(config, call, e.code === "missing_api_key" ? "not_run" : "error", e.code ?? "unknown", e.message ?? String(err));
          const retryable = e instanceof EngineError && (e.retryable || e.code === "rate_limited" || e.code === "server_error" || e.code === "timeout");
          if (!retryable || attempt === MAX_ATTEMPTS) break;
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      reserved -= reserve;
    }
    answers[i] = record;
    done++;
    opts.onProgress?.(done, calls.length, record);
  };

  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, async () => {
    while (next < calls.length) await one(next++);
  });
  await Promise.all(workers);

  return {
    tool: { name: "geopulse-scanner", version: TOOL_VERSION },
    protocol: {
      version: "v1",
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      samplesPerQuestion: SAMPLES_PER_PROMPT,
      engines: FULL_REPORT_ENGINES.map(({ engine, model, searchPolicy }) => ({ engine, model, searchPolicy, label: engineLabel(engine) })),
    },
    config,
    startedAt,
    finishedAt: new Date().toISOString(),
    costUsd: Math.round(spent * 10000) / 10000,
    demo: false,
    answers,
  };
}
