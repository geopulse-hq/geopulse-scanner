// GENERATED from GeoPulse src/server/services/citationClassifier.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Citation classifier.
 *
 * Takes raw Citation[] from the engine adapter layer and augments each
 * citation with:
 *   - domainCategory (owned | competitor | news | social | ...)
 *   - isOwned (matches brand.domain or brand.ownedDomains)
 *   - competitorMatch (name of matched competitor, if any)
 *
 * Pure function — no DB writes, no async work.
 */

import type { Citation } from "../adapters/types";
import type {
  ClassifiedCitation,
  BrandInput,
  CompetitorInput,
  DomainCategory,
} from "./types";
import { classifyDomain, domainMatches } from "./domains";

/**
 * Domains that are internal engine plumbing, not real third-party sources.
 * Citations pointing at these are noise — filter them before classification.
 */
const JUNK_DOMAIN_PATTERNS = [
  "vertexaisearch.cloud.google.com", // Gemini grounding redirect
  "google.com/search",               // Google SERP
  "bing.com/search",                 // Bing SERP
  "perplexity.ai",                   // Perplexity self-reference
  "duckduckgo.com",                  // DDG SERP
  "search.yahoo.com",               // Yahoo SERP
];

function isJunkCitation(url: string, domain: string): boolean {
  const lower = (url || "").toLowerCase();
  const domLower = (domain || "").toLowerCase();
  return JUNK_DOMAIN_PATTERNS.some(
    (p) => domLower.includes(p) || lower.includes(p),
  );
}

export function classifyCitations(
  citations: Citation[],
  brand: BrandInput,
  competitors: CompetitorInput[] = [],
): ClassifiedCitation[] {
  const ownedDomains = collectOwnedDomains(brand);

  return citations.filter((c) => !isJunkCitation(c.url, c.domain)).map((c) => {
    // 1. Owned check
    const isOwned = ownedDomains.some((d) => domainMatches(c.domain, d));

    // 2. Competitor check
    let competitorMatch: string | undefined;
    let competitorCategory: DomainCategory | undefined;
    for (const comp of competitors) {
      if (comp.domain && domainMatches(c.domain, comp.domain)) {
        competitorMatch = comp.name;
        competitorCategory = "competitor";
        break;
      }
    }

    // 3. Final category: owned > competitor > generic classification
    const category: DomainCategory = isOwned
      ? "owned"
      : (competitorCategory ?? classifyDomain(c.domain));

    return {
      ...c,
      domainCategory: category,
      isOwned,
      competitorMatch,
    };
  });
}

/**
 * Aggregate citation counts by category.
 */
export function citationStats(
  classified: ClassifiedCitation[],
): Record<DomainCategory, number> {
  const stats: Record<DomainCategory, number> = {
    owned: 0,
    competitor: 0,
    news: 0,
    social: 0,
    wikipedia: 0,
    forum: 0,
    docs: 0,
    academic: 0,
    government: 0,
    "third-party": 0,
  };
  for (const c of classified) {
    stats[c.domainCategory]++;
  }
  return stats;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function collectOwnedDomains(brand: BrandInput): string[] {
  const out = new Set<string>();
  if (brand.domain) out.add(brand.domain);
  for (const d of brand.ownedDomains ?? []) out.add(d);
  return Array.from(out);
}
