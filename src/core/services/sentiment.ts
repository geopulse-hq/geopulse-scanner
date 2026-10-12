// GENERATED from GeoPulse src/server/services/sentiment.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Sentiment scoring.
 *
 * Two paths:
 *  - `scoreSentiment` — sync lexicon scorer. Cheap, deterministic, no network.
 *    Used inline during mention extraction so the enricher stays synchronous.
 *  - `batchScoreSentimentWithClaude` — async Claude Haiku call. Used by the
 *    async enrichment path to upgrade the lexicon scores with model-based
 *    judgments on the surrounding sentence. Batched to amortize API cost.
 *
 * Canonical range is [-1, 1] throughout the pipeline. `toDisplayScore100`
 * converts to the -100/+100 range used in user-facing summaries and API
 * responses per the product spec.
 *
 * Claude failure (missing key, network, malformed JSON) falls back to the
 * lexicon score — the upgrade is always best-effort.
 */

import type { Sentiment, SentimentLabel } from "./types";
import { env } from "../shims/env";
import { withRetry } from "../shims/utils";

// ─── Lexicons ───────────────────────────────────────────────────────────
// Words are matched case-insensitively with word boundaries.

const POSITIVE_WORDS = new Set([
  // Quality / recommendation
  "best",
  "top",
  "leading",
  "premier",
  "excellent",
  "outstanding",
  "exceptional",
  "superior",
  "preferred",
  "recommended",
  "trusted",
  "reputable",
  "renowned",
  "respected",
  "established",
  "reliable",
  "proven",
  "expert",
  "specialist",
  "professional",
  "comprehensive",
  "thorough",
  "efficient",
  "effective",
  "innovative",
  "advanced",
  "modern",
  "popular",
  "favorite",
  "preferred",

  // Pricing / value
  "affordable",
  "fair",
  "transparent",
  "competitive",
  "value",
  "worth",
  "savings",

  // Outcomes
  "successful",
  "win",
  "won",
  "victory",
  "growth",
  "fast",
  "quick",
  "rapid",
  "responsive",

  // Positive descriptors
  "great",
  "good",
  "strong",
  "robust",
  "solid",
  "high",
  "high-quality",
  "high-end",
  "premium",
  "elite",

  // Chinese (limited set)
  "优秀",
  "专业",
  "可靠",
  "推荐",
  "领先",
  "权威",
]);

const NEGATIVE_WORDS = new Set([
  // Quality issues
  "worst",
  "bad",
  "poor",
  "weak",
  "unreliable",
  "untrustworthy",
  "questionable",
  "dubious",
  "shady",
  "scam",
  "fraud",
  "fake",
  "illegitimate",
  "unethical",
  "controversial",
  "criticized",
  "complained",
  "complaints",

  // Avoidance
  "avoid",
  "beware",
  "warning",
  "risky",
  "dangerous",
  "unsafe",
  "problematic",

  // Pricing / value
  "expensive",
  "overpriced",
  "hidden",
  "surprise",
  "ripoff",
  "rip-off",
  "wasted",

  // Outcomes
  "failed",
  "failure",
  "lost",
  "lose",
  "broke",
  "broken",
  "delayed",
  "slow",
  "unresponsive",
  "ignored",
  "abandoned",

  // Negative descriptors
  "terrible",
  "horrible",
  "awful",
  "subpar",
  "inferior",
  "outdated",
  "obsolete",
  "deprecated",
  "limited",
  "lacking",
  "missing",
  "incomplete",

  // Chinese (limited set)
  "差",
  "糟",
  "骗",
  "失败",
  "陷阱",
  "欺诈",
]);

// Words that strongly amplify when present near brand mention
const NEGATION_WORDS = new Set([
  "not",
  "no",
  "never",
  "without",
  "lacks",
  "fails",
  "isn't",
  "wasn't",
  "doesn't",
  "don't",
  "didn't",
  "won't",
  "cannot",
  "can't",
]);

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Score a single text snippet (typically one sentence around a brand mention).
 */
export function scoreSentiment(text: string): Sentiment {
  if (!text) return { score: 0, label: "neutral" };

  const tokens = tokenize(text);
  if (tokens.length === 0) return { score: 0, label: "neutral" };

  let posCount = 0;
  let negCount = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const isPositive = POSITIVE_WORDS.has(tok);
    const isNegative = NEGATIVE_WORDS.has(tok);

    if (!isPositive && !isNegative) continue;

    // Crude negation handling: flip the polarity if a negation word
    // appears within 3 tokens before this one.
    const negated = hasNegationBefore(tokens, i, 3);

    if (isPositive) {
      if (negated) negCount++;
      else posCount++;
    } else if (isNegative) {
      if (negated) posCount++;
      else negCount++;
    }
  }

  if (posCount === 0 && negCount === 0) {
    return { score: 0, label: "neutral" };
  }

  // Normalize: divide by sqrt(token count) so longer text doesn't drown out signal
  const denominator = Math.max(1, Math.sqrt(tokens.length));
  let score = (posCount - negCount) / denominator;

  // Clamp to [-1, 1]
  score = Math.max(-1, Math.min(1, score));

  return { score, label: labelFor(score) };
}

/**
 * Aggregate multiple sentiment scores into one. Used for brand-level summary.
 * Empty input → neutral.
 */
export function aggregateSentiment(items: Sentiment[]): Sentiment {
  if (items.length === 0) return { score: 0, label: "neutral" };
  const sum = items.reduce((a, s) => a + s.score, 0);
  const avg = sum / items.length;
  return { score: avg, label: labelFor(avg) };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  // Match Latin words OR CJK characters
  const matches = text.toLowerCase().match(/[a-z0-9'-]+|[\u4e00-\u9fff]+/g);
  return matches ?? [];
}

function hasNegationBefore(tokens: string[], idx: number, window: number): boolean {
  const start = Math.max(0, idx - window);
  for (let i = start; i < idx; i++) {
    if (NEGATION_WORDS.has(tokens[i]!)) return true;
  }
  return false;
}

function labelFor(score: number): SentimentLabel {
  if (score > 0.1) return "positive";
  if (score < -0.1) return "negative";
  return "neutral";
}

// ─── Display conversion ─────────────────────────────────────────────────

/** Convert canonical [-1, 1] score to the -100/+100 display range. */
export function toDisplayScore100(s: Sentiment): number {
  return Math.round(s.score * 100);
}

// ─── Claude-based scorer ────────────────────────────────────────────────

import { logAnthropicUsage } from "../shims/apiUsage";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const SENTIMENT_MODEL = "claude-haiku-4-5";
const MAX_BATCH_SIZE = 20;

export type SentimentTarget = {
  /** The sentence or surrounding context containing the mention. */
  context: string;
  /** The brand/competitor being evaluated inside that context. */
  entity: string;
};

/**
 * Score one mention via Claude. Falls back to lexicon on any failure.
 * Prefer `batchScoreSentimentWithClaude` for anything non-trivial.
 */
export async function scoreSentimentWithClaude(target: SentimentTarget): Promise<Sentiment> {
  const results = await batchScoreSentimentWithClaude([target]);
  return results[0]!;
}

/**
 * Batch-score many mentions in a single Claude call. Each target gets one
 * score in the same order as the input. On failure every target falls back
 * to the lexicon score of its own context.
 *
 * Input larger than MAX_BATCH_SIZE is split into multiple calls and merged.
 */
export async function batchScoreSentimentWithClaude(
  targets: SentimentTarget[],
): Promise<Sentiment[]> {
  if (targets.length === 0) return [];

  const apiKey = env.ANTHROPIC_API_KEY();
  if (!apiKey) {
    return targets.map((t) => scoreSentiment(t.context));
  }

  if (targets.length > MAX_BATCH_SIZE) {
    const out: Sentiment[] = [];
    for (let i = 0; i < targets.length; i += MAX_BATCH_SIZE) {
      const chunk = targets.slice(i, i + MAX_BATCH_SIZE);
      out.push(...(await batchScoreSentimentWithClaude(chunk)));
    }
    return out;
  }

  try {
    const scores = await callClaudeSentiment(apiKey, targets);
    return targets.map((t, i) => {
      const raw = scores[i];
      if (typeof raw !== "number" || Number.isNaN(raw)) {
        return scoreSentiment(t.context);
      }
      const clamped = Math.max(-1, Math.min(1, raw));
      return { score: clamped, label: labelFor(clamped) };
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[sentiment] Claude scoring failed, using lexicon fallback:", (err as Error).message);
    }
    return targets.map((t) => scoreSentiment(t.context));
  }
}

async function callClaudeSentiment(
  apiKey: string,
  targets: SentimentTarget[],
): Promise<number[]> {
  const numbered = targets
    .map(
      (t, i) =>
        `${i + 1}. Entity: "${escapeForPrompt(t.entity)}"\n   Context: "${escapeForPrompt(t.context)}"`,
    )
    .join("\n\n");

  const userMessage = `You are a sentiment analyst. For each numbered item below, judge the sentiment expressed TOWARD the named entity in its context. Use a score from -1.0 (very negative) to 1.0 (very positive), with 0 meaning neutral or purely factual.

Rules:
- Score only sentiment toward the entity itself — ignore sentiment about unrelated things in the same sentence.
- A neutral factual mention (e.g. "X was founded in 1990") is 0.
- Criticism, warnings, or negative framing toward the entity are negative.
- Praise, recommendation, or endorsement are positive.

Return ONLY a JSON object in this exact shape, with one score per item in order:
{"scores":[<number>, <number>, ...]}

Items:
${numbered}`;

  const body = {
    model: SENTIMENT_MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: userMessage }],
  };

  const data = await withRetry(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
        }
        return (await res.json()) as {
          content: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      } finally {
        clearTimeout(timer);
      }
    },
    { retries: 2, baseMs: 500, label: "sentiment.claude" },
  );

  // Telemetry — fire-and-forget so a failed insert never breaks a scan.
  void logAnthropicUsage(data, {
    model: SENTIMENT_MODEL,
    operation: "sentiment",
  });

  const text = data.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("");

  return parseScoresJson(text, targets.length);
}

/** Extract the JSON {"scores":[...]} block from Claude's response text. */
export function parseScoresJson(text: string, expectedLength: number): number[] {
  // Claude sometimes wraps JSON in prose or code fences — find the first { ... }
  const match = text.match(/\{[\s\S]*?"scores"[\s\S]*?\}/);
  if (!match) {
    throw new Error(`No scores JSON found in response: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(match[0]) as { scores?: unknown };
  if (!Array.isArray(parsed.scores)) {
    throw new Error("scores field is not an array");
  }
  if (parsed.scores.length !== expectedLength) {
    throw new Error(
      `scores length ${parsed.scores.length} does not match expected ${expectedLength}`,
    );
  }
  return parsed.scores.map((v) => (typeof v === "number" ? v : NaN));
}

function escapeForPrompt(s: string): string {
  // Prevent the user text from breaking out of the quoted structure.
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 500);
}
