// GENERATED from GeoPulse src/server/services/recommendation.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Did an answer present an entity (the brand or a tracked competitor) as an
 * option to choose — a product, brand, manufacturer, store, software or
 * service provider? Each decision carries the rule that fired and the text
 * it fired on, so a person can check it.
 *
 * Counts as recommended:
 *   option_list_item        — a list item that starts with the entity's name.
 *                             In a knowledge answer the item must also
 *                             describe a service (not just a source).
 *   explicit_recommendation — a recommending verb aimed at the entity
 *                             ("consider Acme", "Acme is a reliable option").
 *   provider_description    — recommendation-search answers only: the entity
 *                             is the subject of an offering sentence
 *                             ("Acme offers fixed-fee contract review",
 *                             "Acme makes waterproof LED strips").
 * Never counts: a generic "consider"/"recommend" aimed at something else,
 * negative wording near the entity (marked negative instead), and URLs
 * (mentions inside links are dropped upstream).
 */

import { listItems, optionItemFor } from "./brandExtractor";
import type { PromptIntent } from "./protocol";

export type RecommendationRule = "option_list_item" | "explicit_recommendation" | "provider_description";

export type Recommendation = {
  recommended: boolean;
  negative: boolean;
  rule: RecommendationRule | null;
  snippet: string | null;
  /** Position in a numbered list of options; null for unordered lists or prose. */
  listRank: number | null;
};

type Mention = { position: number; matchedText: string; context?: string };

const NEGATIVE = /\b(not recommended|avoid|beware|scam|fraud(?:ulent)?|complaints? against|blacklist(?:ed)?|unreliable|problematic)\b/i;
const VERB_BEFORE = /\b(?:recommend(?:ed|s)?|suggest(?:ed|s)?|consider(?:ing)?|try|contact(?:ing)?|reach(?:ing)? out to|engag(?:e|ing)|hir(?:e|ing)|work(?:ing)? with)\b(?:\s+(?:using|with|a firm like|firms? such as|providers? such as|services? like|such as|like|the))*\s*(?:\*\*|\[)?\s*$/i;
const PRAISE_AFTER = /^[^.!?\n]{0,40}?\b(?:is|are|would be|remains)\s+(?:a |an |the |one of the )?(?:good|great|solid|strong|reliable|reputable|trusted|well[- ]regarded|recommended|leading|popular|cost-effective|practical|top)\b/i;
const SERVICE_AFTER = /^(?:\*\*)?(?:\]\([^)]*\))?(?:\*\*)?(?:\s*\([^)]{0,80}\))?\s*(?:[:—–-]\s*)?(?:is an?|are|offers|provides|sells|makes|manufactures|produces|supplies|builds|develops|ships|speciali[sz]es in|focuses on|helps|assists|handles|drafts|reviews|verifies|can (?:help|draft|review|verify|assist|handle|supply|make)|supports|works with|represents)\b/i;
/** Words that make a list item an offering rather than a cited source. */
const SERVICE_WORDS = /\b(offers?|provides?|sells?|makes?|manufactur\w*|produc\w*|suppl\w*|services?|products?|brands?|stores?|shops?|software|apps?|platforms?|tools?|helps?|assists?|law firm|lawyers?|attorneys?|consult\w*|review\w*|draft\w*|verif\w*|fixed[- ]fee|fees?|pricing|prices?|from (?:US)?\$)\b/i;

function sentenceAround(text: string, pos: number): { start: number; end: number } {
  let start = pos;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1]!)) start--;
  let end = pos;
  while (end < text.length && !/[.!?\n]/.test(text[end]!)) end++;
  return { start, end };
}

function clip(text: string, start: number, end: number): string {
  return text.slice(start, Math.min(end, start + 240)).trim();
}

export function detectRecommendation(text: string, mentions: Mention[], intent: PromptIntent | null): Recommendation {
  const none: Recommendation = { recommended: false, negative: false, rule: null, snippet: null, listRank: null };
  if (!text || mentions.length === 0) return none;

  for (const m of mentions) {
    const ctx = text.slice(Math.max(0, m.position - 60), m.position + m.matchedText.length + 60);
    if (NEGATIVE.test(ctx)) return { ...none, negative: true, snippet: ctx.trim() };
  }

  const item = optionItemFor(text, mentions.map((m) => m.position));
  if (item) {
    const body = text.slice(item.start, item.end);
    if (intent !== "research_citation" || SERVICE_WORDS.test(body)) {
      return { recommended: true, negative: false, rule: "option_list_item", snippet: clip(text, item.start, item.end), listRank: item.rank };
    }
  }

  for (const m of mentions) {
    const { start, end } = sentenceAround(text, m.position);
    const before = text.slice(Math.max(start, m.position - 60), m.position);
    const after = text.slice(m.position + m.matchedText.length, end);
    if (VERB_BEFORE.test(before) || PRAISE_AFTER.test(after)) {
      return { recommended: true, negative: false, rule: "explicit_recommendation", snippet: clip(text, start, end), listRank: null };
    }
    if (intent === "provider_discovery" && SERVICE_AFTER.test(after)) {
      return { recommended: true, negative: false, rule: "provider_description", snippet: clip(text, start, end), listRank: null };
    }
  }
  return none;
}

/**
 * Brand outcome for one answer:
 *   negative | recommended | mentioned (named only) | cited (own site cited, not named) | null
 */
export function mentionTypeOf(input: { named: boolean; ownedCited: boolean; recommendation: Recommendation }): string | null {
  if (input.recommendation.negative) return "negative";
  if (input.recommendation.recommended) return "recommended";
  if (input.named) return "mentioned";
  if (input.ownedCited) return "cited";
  return null;
}

/**
 * Recommendation-search answers only: did it actually name candidates?
 * A flag for review — never used to drop an answer from the denominator.
 */
export function answerFitOf(text: string, intent: PromptIntent | null): string | null {
  if (intent !== "provider_discovery") return null;
  // Items whose first word is bold or a link — a named candidate, not a step.
  const named = listItems(text).filter((it) => /\*\*|\[/.test(text.slice(it.start, it.lead)));
  if (named.length > 0) return "listed_candidates";
  if (/\b(?:could ?n[o']t|unable to|did ?n[o']t|cannot|can't) (?:find|identify|locate|confirm)\b|\bno (?:reliable|specific|verified|publicly listed) (?:providers?|candidates?|firms?|lawyers?)\b|\bnot aware of any\b/i.test(text)) {
    return "no_candidates_stated";
  }
  return "no_candidates_listed";
}
