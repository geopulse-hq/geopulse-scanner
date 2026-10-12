// GENERATED from GeoPulse src/server/services/resultEnricher.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Result enricher.
 *
 * The boundary between raw engine API data and business intelligence.
 *
 *   QueryResult (wire format) ──enrich(brand, competitors)──> EnrichedResult
 *
 * Pure function. No DB writes, no async work, no API calls. Safe to call
 * inline during a scan or on-demand from a UI handler.
 */

import type { QueryResult } from "../adapters/types";
import type {
  EnrichedResult,
  BrandInput,
  CompetitorInput,
  BrandMention,
  CompetitorMentionParsed,
  Sentiment,
} from "./types";
import { classifyCitations, citationStats } from "./citationClassifier";
import {
  extractBrandMentions,
  extractCompetitorMentions,
} from "./brandExtractor";
import {
  aggregateSentiment,
  batchScoreSentimentWithClaude,
  type SentimentTarget,
} from "./sentiment";
import { answerFitOf, detectRecommendation, mentionTypeOf } from "./recommendation";
import type { PromptIntent } from "./protocol";

export type EnrichOptions = {
  brand: BrandInput;
  competitors?: CompetitorInput[];
  /** Question intent — changes what counts as a recommendation. */
  intent?: PromptIntent | null;
};

/**
 * Enrich a single QueryResult with brand mentions, classified citations,
 * and sentiment.
 */
export function enrichResult(result: QueryResult, options: EnrichOptions): EnrichedResult {
  const { brand, competitors = [] } = options;

  // 1. Brand mentions in responseText
  const brandMentions = extractBrandMentions(result.responseText, brand);

  // 2. Competitor mentions
  const competitorMentions = extractCompetitorMentions(result.responseText, competitors);

  // 3. Citation classification (incl. owned + competitor matching)
  const classifiedCitations = classifyCitations(result.citations, brand, competitors);

  // 4. Aggregate brand sentiment over all mentions
  const brandSentiment =
    brandMentions.length > 0 ? aggregateSentiment(brandMentions.map((m) => m.sentiment)) : null;

  // 5. Mentioned = named in the text OR the brand's own site is cited.
  // Rank only exists when the answer is a numbered list (see computeListRank).
  // Links to the brand's own site written in the answer text count as
  // citations too, but are marked as text links — not API citations.
  for (const link of ownedTextLinks(result.responseText, ownedDomainsOf(brand))) {
    if (classifiedCitations.some((c) => c.url === link.url)) continue;
    classifiedCitations.push({
      url: link.url,
      domain: link.domain,
      position: classifiedCitations.length + 1,
      startIndex: link.index,
      endIndex: link.index + link.url.length,
      origin: "text_link",
      domainCategory: "owned",
      isOwned: true,
    });
  }
  const ownedCited = classifiedCitations.some((c) => c.isOwned);
  const brandMentioned = brandMentions.length > 0 || ownedCited;
  const intent = options.intent ?? null;
  const recommendation = detectRecommendation(result.responseText, brandMentions, intent);
  // A rank exists only for a recommendation that heads a numbered list item.
  const brandRankPosition = recommendation.recommended ? recommendation.listRank : null;
  const mentionType = mentionTypeOf({ named: brandMentions.length > 0, ownedCited, recommendation });

  // Competitors judged by the same rule, once per competitor per answer.
  const competitorRecommendations: EnrichedResult["competitorRecommendations"] = {};
  const byCompetitor = new Map<string, CompetitorMentionParsed[]>();
  for (const m of competitorMentions) byCompetitor.set(m.competitorName, [...(byCompetitor.get(m.competitorName) ?? []), m]);
  for (const [name, ms] of byCompetitor) {
    competitorRecommendations[name] = detectRecommendation(result.responseText, ms, intent);
  }

  // 6. Citation stats by category
  const stats = citationStats(classifiedCitations);

  return {
    ...result,
    brandMentions,
    competitorMentions,
    classifiedCitations,
    brandMentioned,
    ownedCited,
    brandRankPosition,
    recommendation,
    mentionType,
    answerFit: answerFitOf(result.responseText, intent),
    competitorRecommendations,
    brandSentiment,
    citationStats: stats,
  };
}

/**
 * Enrich many results at once. Convenience for queryAll().
 * Errors and skipped engines pass through unchanged (the enricher is a no-op
 * on missing data).
 */
export function enrichResults(
  results: QueryResult[],
  options: EnrichOptions,
): EnrichedResult[] {
  return results.map((r) => enrichResult(r, options));
}

// ─── Async Claude-backed enrichment ─────────────────────────────────────

/**
 * Same as `enrichResult` but replaces the lexicon sentiment on every brand
 * and competitor mention with a Claude-scored judgment. Aggregate brand
 * sentiment is recomputed from the upgraded per-mention scores.
 *
 * Falls back to the lexicon result when ANTHROPIC_API_KEY is missing or the
 * API call fails — callers can rely on always getting an EnrichedResult.
 */
export async function enrichResultWithClaudeSentiment(
  result: QueryResult,
  options: EnrichOptions,
): Promise<EnrichedResult> {
  const baseline = enrichResult(result, options);

  const targets: SentimentTarget[] = [];
  for (const m of baseline.brandMentions) {
    targets.push({ context: m.context, entity: m.brandName });
  }
  for (const m of baseline.competitorMentions) {
    targets.push({ context: m.context, entity: m.competitorName });
  }

  if (targets.length === 0) return baseline;

  const scored = await batchScoreSentimentWithClaude(targets);

  let cursor = 0;
  const upgradedBrand: BrandMention[] = baseline.brandMentions.map((m) => ({
    ...m,
    sentiment: scored[cursor++]!,
  }));
  const upgradedCompetitor: CompetitorMentionParsed[] = baseline.competitorMentions.map(
    (m) => ({
      ...m,
      sentiment: scored[cursor++]!,
    }),
  );

  const brandSentiment: Sentiment | null =
    upgradedBrand.length > 0 ? aggregateSentiment(upgradedBrand.map((m) => m.sentiment)) : null;

  return {
    ...baseline,
    brandMentions: upgradedBrand,
    competitorMentions: upgradedCompetitor,
    brandSentiment,
  };
}

function ownedDomainsOf(brand: EnrichOptions["brand"]): string[] {
  return [brand.domain, ...(brand.ownedDomains ?? [])].filter((d): d is string => !!d);
}

/** Links in the text to one of the domains: "https://www.acme.com/…". */
export function ownedTextLinks(text: string, domains: string[]): Array<{ url: string; domain: string; index: number }> {
  const out: Array<{ url: string; domain: string; index: number }> = [];
  for (const d of domains) {
    const host = d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
    if (!host) continue;
    const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`https?://(?:[\\w-]+\\.)*${escaped}(?:[/?#][^\\s)\\]"'<>]*)?`, "gi");
    for (const m of text.matchAll(re)) {
      const url = m[0].replace(/[.,;:]+$/, "");
      out.push({ url, domain: host, index: m.index ?? 0 });
    }
  }
  return out;
}

/** True if the text links to one of the domains. */
export function linksToDomain(text: string, domains: string[]): boolean {
  return ownedTextLinks(text, domains).length > 0;
}
