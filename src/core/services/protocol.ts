// GENERATED from GeoPulse src/server/services/protocol.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Detection protocol v1 — the fixed rules every full report runs under.
 *
 * A report is only comparable with another report run under the same
 * protocol: same question set version, same engines + models + search
 * mode, same system instructions, same number of samples. Everything that
 * changes an answer is named and versioned here and recorded on each scan
 * and each result.
 */

import type { EngineName } from "../shims/appTypes";

/**
 * provider_discovery — the user wants something to buy or someone to work
 *   with (product, brand, manufacturer, store, software, service provider).
 *   Shown to users as "find a recommendation"; the internal name stays.
 * research_citation  — the user wants to understand something.
 */
export type PromptIntent = "provider_discovery" | "research_citation";
export const PROMPT_INTENTS: PromptIntent[] = ["provider_discovery", "research_citation"];

/** OpenAI must search (tool_choice=required); Perplexity always retrieves on its own. */
export type SearchPolicy = "required" | "auto" | "provider_default";

export type EngineProtocol = {
  engine: EngineName;
  /** Model we request. The model the API actually ran is recorded per result. */
  model: string;
  searchPolicy: SearchPolicy;
  /** Shown in the report — names the API, never "ChatGPT ranking". */
  label: string;
};

export const SAMPLES_PER_PROMPT = 2;
export const MAX_PROMPTS = 10;
export const PROVIDER_PROMPTS = 6;
export const RESEARCH_PROMPTS = 4;

export const FULL_REPORT_ENGINES: EngineProtocol[] = [
  { engine: "openai", model: "gpt-4o-mini", searchPolicy: "required", label: "OpenAI API · gpt-4o-mini · 联网检测" },
  { engine: "perplexity", model: "sonar", searchPolicy: "provider_default", label: "Perplexity API · sonar" },
];

export const FREE_PREVIEW_ENGINES: EngineProtocol[] = [FULL_REPORT_ENGINES[1]!];
export const FREE_PREVIEW_SAMPLES = 1;

export function engineProtocol(engine: EngineName): EngineProtocol | undefined {
  return FULL_REPORT_ENGINES.find((e) => e.engine === engine);
}

/**
 * Neutral system instructions, versioned. They never name a brand, a
 * domain, a competitor or a previous result, and never restrict which
 * sites may be searched. A question set is frozen with the version it was
 * created under and always runs with THAT version's text — a newer version
 * is never applied silently to an older set; scans record the version used.
 *
 *   sp-v1 — recommendation questions phrased for service providers
 *   sp-v2 — recommendation questions cover products, brands, manufacturers,
 *           stores, software and service providers
 */
type InstructionSet = (intent: PromptIntent | null, lang: string) => string[];

const RESEARCH: InstructionSet = (_i, lang) => ["Answer the question directly and accurately.", "Cite the sources you relied on.", lang];

const SYSTEM_PROMPTS: Record<string, InstructionSet> = {
  "sp-v1": (intent, lang) =>
    intent === "provider_discovery"
      ? [
          "The user is looking for someone to provide a service. Answer that actual need.",
          "Based on public sources, name the relevant candidate providers and give each one's website.",
          "Do not favour any particular brand.",
          "If you cannot find enough reliable candidates, say so plainly. Do not invent providers or pad the list to a fixed number.",
          "Cite the sources you relied on.",
          lang,
        ]
      : RESEARCH(intent, lang),
  "sp-v2": (intent, lang) =>
    intent === "provider_discovery"
      ? [
          "The user is looking for something to buy or someone to work with — a product, brand, manufacturer, store, software or service provider. Answer that actual need.",
          "Based on public sources, name the relevant candidates and give each one's website.",
          "Do not favour any particular brand.",
          "If you cannot find enough reliable candidates, say so plainly. Do not invent candidates or pad the list to a fixed number.",
          "Cite the sources you relied on.",
          lang,
        ]
      : RESEARCH(intent, lang),
};

/** Version given to question sets created from now on. */
export const SYSTEM_PROMPT_VERSION = "sp-v2";

export function systemPromptFor(intent: PromptIntent | null, language: string, version: string = SYSTEM_PROMPT_VERSION): string {
  const build = SYSTEM_PROMPTS[version];
  if (!build) throw new Error(`Unknown system prompt version ${version} — refusing to substitute another one.`);
  const lang = language.toLowerCase().startsWith("zh") ? "Answer in Chinese." : "Answer in English.";
  return build(intent, lang).join(" ");
}

/** Everything that changes an engine's answer — part of the cache key. */
export function protocolCacheTag(p: {
  model: string;
  searchPolicy: SearchPolicy;
  systemPromptVersion: string;
  promptSetVersion: string | null;
  intent: PromptIntent | null;
}): string {
  return [p.model, p.searchPolicy, p.systemPromptVersion, p.promptSetVersion ?? "-", p.intent ?? "-"].join("|");
}

/**
 * Budget reserved before EACH paid attempt, then settled to the billed
 * amount. These are conservative estimates from the per-call limits we set,
 * NOT guaranteed ceilings — neither API lets a caller fix the input size
 * (search context) in advance.
 *
 * OpenAI gpt-4o-mini, max_tool_calls=2, max_output_tokens=2000
 *   search content is billed as a fixed 8,000-token block per call; the
 *   rest of the input is the short question + instructions (a probe used
 *   ~540 tokens beyond the block). Assume ≤ 2 × 8,000 + 4,000 = 20,000 in:
 *   20,000 × $0.15/M + 2,000 × $0.60/M + 2 × $0.01 ≈ $0.0242 → reserve $0.025
 *
 * Perplexity sonar, max_tokens=1024, search_context_size=low
 *   request fee (low) $0.005 + output ≤ 1,024 × $1/M ≈ $0.001 + input at
 *   $1/M; the retrieved context billed as input is not capped by the API
 *   (a probe billed $0.0023 of input on a 35-token question). Allow
 *   10,000 input tokens ($0.010) → reserve $0.016.
 *
 * A response that costs more than its reservation is recorded at its real
 * cost, and the caps see it on the next reservation.
 */
export const RESERVE_USD: Partial<Record<EngineName, number>> = {
  openai: 0.025,
  perplexity: 0.016,
};

/** Paid attempts per answer (1 + retries on rate limit / server error / timeout). */
export const MAX_ATTEMPTS = 2;
