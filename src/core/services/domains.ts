// GENERATED from GeoPulse src/server/services/domains.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Domain category lookup tables.
 *
 * Used by the citation classifier to label citations as news / social /
 * wikipedia / forum / docs / academic / government / third-party.
 *
 * Lists are intentionally hand-curated and conservative. False positives are
 * worse than false negatives — when in doubt, fall through to "third-party".
 *
 * Match strategy: a citation domain matches a list entry if it equals the
 * entry OR ends with `.${entry}` (so subdomains like en.wikipedia.org match).
 */

import type { DomainCategory } from "./types";

const NEWS_DOMAINS = new Set([
  "nytimes.com",
  "wsj.com",
  "bloomberg.com",
  "reuters.com",
  "bbc.com",
  "bbc.co.uk",
  "ft.com",
  "economist.com",
  "scmp.com",
  "theguardian.com",
  "washingtonpost.com",
  "cnn.com",
  "nbcnews.com",
  "cnbc.com",
  "forbes.com",
  "businessinsider.com",
  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "arstechnica.com",
  "axios.com",
  "politico.com",
  "thetimes.co.uk",
  "telegraph.co.uk",
  "lemonde.fr",
  "spiegel.de",
  "asahi.com",
  "yomiuri.co.jp",
  "globaltimes.cn",
  "chinadaily.com.cn",
  "nikkei.com",
  "straitstimes.com",
  "channelnewsasia.com",
  "japantimes.co.jp",
  "ndtv.com",
  "thehindu.com",
]);

const SOCIAL_DOMAINS = new Set([
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "pinterest.com",
  "snapchat.com",
  "threads.net",
  "mastodon.social",
  "bluesky.app",
  "bsky.app",
  "weibo.com",
  "wechat.com",
  "zhihu.com",
  "xiaohongshu.com",
  "douyin.com",
]);

const FORUM_DOMAINS = new Set([
  "reddit.com",
  "stackoverflow.com",
  "stackexchange.com",
  "superuser.com",
  "serverfault.com",
  "quora.com",
  "news.ycombinator.com",
  "hackernews.com",
  "lobste.rs",
  "discourse.org",
]);

const WIKIPEDIA_DOMAINS = new Set([
  "wikipedia.org",
  "wikidata.org",
  "wikimedia.org",
]);

const DOCS_DOMAINS = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "npmjs.com",
  "pypi.org",
  "rubygems.org",
  "crates.io",
  "developer.mozilla.org",
  "developer.apple.com",
  "developer.android.com",
  "developers.google.com",
  "learn.microsoft.com",
  "docs.microsoft.com",
  "readthedocs.io",
  "readthedocs.org",
  "gitbook.io",
]);

const ACADEMIC_DOMAINS = new Set([
  "arxiv.org",
  "biorxiv.org",
  "scholar.google.com",
  "jstor.org",
  "researchgate.net",
  "academia.edu",
  "ssrn.com",
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "sciencedirect.com",
  "springer.com",
  "nature.com",
  "science.org",
  "ieee.org",
  "acm.org",
]);

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Classify a single domain into a category.
 *
 * Order of evaluation matters: wikipedia → academic → docs → forum → news → social → tld → third-party.
 * Owned/competitor classification is handled by the caller (it requires extra context).
 */
export function classifyDomain(domain: string): DomainCategory {
  if (!domain) return "third-party";
  const d = domain.toLowerCase().replace(/^www\./, "");

  if (matchesSet(d, WIKIPEDIA_DOMAINS)) return "wikipedia";
  if (matchesSet(d, ACADEMIC_DOMAINS)) return "academic";
  if (matchesSet(d, DOCS_DOMAINS) || d.startsWith("docs.")) return "docs";
  if (matchesSet(d, FORUM_DOMAINS)) return "forum";
  if (matchesSet(d, NEWS_DOMAINS)) return "news";
  if (matchesSet(d, SOCIAL_DOMAINS)) return "social";

  // TLD-based fallbacks (works for both "treasury.gov" and "gov.uk" itself)
  if (
    endsWithTld(d, "gov") ||
    endsWithTld(d, "gov.cn") ||
    endsWithTld(d, "gov.uk") ||
    endsWithTld(d, "gc.ca")
  ) {
    return "government";
  }
  if (endsWithTld(d, "edu") || endsWithTld(d, "ac.uk") || endsWithTld(d, "edu.cn")) {
    return "academic";
  }

  return "third-party";
}

/** True if `d` ends with `.tld` OR equals `tld` exactly. */
function endsWithTld(d: string, tld: string): boolean {
  return d === tld || d.endsWith(`.${tld}`);
}

/** Set match: exact OR domain ends with `.entry`. */
function matchesSet(domain: string, set: Set<string>): boolean {
  if (set.has(domain)) return true;
  for (const entry of set) {
    if (domain.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/** Check if `domain` matches `target` (exact or subdomain). */
export function domainMatches(domain: string, target: string): boolean {
  if (!domain || !target) return false;
  const d = domain.toLowerCase().replace(/^www\./, "");
  const t = target.toLowerCase().replace(/^www\./, "");
  return d === t || d.endsWith(`.${t}`);
}
