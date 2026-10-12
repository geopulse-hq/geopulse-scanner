// GENERATED from GeoPulse src/server/services/types.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Service-layer types — the bridge between raw engine API data and business intelligence.
 *
 * QueryResult (from adapters) is the wire format. EnrichedResult is what the
 * dashboard actually consumes: parsed brand mentions, classified citations,
 * sentiment, and computed metrics.
 */

import type { Citation, QueryResult } from "../adapters/types";

// ─── Domain categorization ──────────────────────────────────────────────

export type DomainCategory =
  | "owned"        // The brand's own domain (or any domain in brand.ownedDomains)
  | "competitor"   // Matches a competitor's domain
  | "news"         // Major news outlets (nytimes, bbc, reuters, scmp...)
  | "social"       // Social platforms (twitter, linkedin, facebook, reddit, youtube)
  | "wikipedia"    // wikipedia.org and language variants
  | "forum"        // Q&A and forums (stackoverflow, quora, hn, reddit)
  | "docs"         // Vendor docs / dev portals (github, npm, mdn, docs.*)
  | "academic"     // .edu, scholar.google, arxiv, jstor
  | "government"   // .gov, .gov.cn, .gc.ca, ec.europa.eu
  | "third-party"; // Default — anything else

export type ClassifiedCitation = Citation & {
  domainCategory: DomainCategory;
  /** True if this citation matched the brand or one of its owned domains. */
  isOwned: boolean;
  /** Name of the matched competitor, if any. */
  competitorMatch?: string;
};

// ─── Brand mention ──────────────────────────────────────────────────────

export type SentimentLabel = "positive" | "neutral" | "negative";

export type Sentiment = {
  /** Score in [-1, 1]. -1 = very negative, 0 = neutral, 1 = very positive. */
  score: number;
  label: SentimentLabel;
};

export type BrandMention = {
  /** The brand's canonical name. */
  brandName: string;
  /** The exact substring that matched (canonical, alias, or domain). */
  matchedText: string;
  /** Match type — useful for prioritization. */
  matchType: "name" | "alias" | "domain";
  /** Surrounding sentence containing the match. */
  context: string;
  /** Character offset of the match in responseText. */
  position: number;
  /** Local sentiment of the surrounding sentence. */
  sentiment: Sentiment;
};

// ─── Competitor mention ─────────────────────────────────────────────────

export type CompetitorMentionParsed = {
  competitorName: string;
  matchedText: string;
  context: string;
  position: number;
  sentiment: Sentiment;
};

// ─── Brand input shape (what callers pass to the enricher) ──────────────

export type BrandInput = {
  name: string;
  /** Alternative names, abbreviations, brand variations. */
  aliases?: string[];
  /** Primary domain (e.g. "acmelighting.com"). Used for citation matching. */
  domain?: string;
  /** Additional owned domains (subdomains, alternate TLDs, microsites). */
  ownedDomains?: string[];
};

export type CompetitorInput = {
  name: string;
  aliases?: string[];
  domain?: string;
};

// ─── Enriched result ────────────────────────────────────────────────────

export type EnrichedResult = QueryResult & {
  /** All brand mentions found in responseText. */
  brandMentions: BrandMention[];
  /** All competitor mentions found in responseText (across all competitors). */
  competitorMentions: CompetitorMentionParsed[];
  /** Citations augmented with domain category + ownership. */
  classifiedCitations: ClassifiedCitation[];
  /** True if the brand was mentioned at least once (named, or own site cited). */
  brandMentioned: boolean;
  /** True if the brand's own site is cited — in the citation list or as a link in the text. */
  ownedCited: boolean;
  /** Whether/why the brand was presented as a provider option. */
  recommendation: import("./recommendation").Recommendation;
  /** negative | recommended | mentioned | cited | null — see mentionTypeOf. */
  mentionType: string | null;
  /** Provider-search answers: listed_candidates | no_candidates_stated | no_candidates_listed. */
  answerFit: string | null;
  /** Same recommendation rule applied to each tracked competitor found in the answer. */
  competitorRecommendations: Record<string, import("./recommendation").Recommendation>;
  /** 1-based rank of brand's first mention (1 = first mentioned thing). null if not mentioned. */
  brandRankPosition: number | null;
  /** Aggregate sentiment averaged over all brand mentions. null if not mentioned. */
  brandSentiment: Sentiment | null;
  /** Counts by domain category for the citation list. */
  citationStats: Record<DomainCategory, number>;
};
