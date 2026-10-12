// GENERATED from GeoPulse src/server/services/brandExtractor.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Brand mention extractor.
 *
 * Splits responseText into sentences and scans each for matches against
 * the brand name, aliases, and domain. Each unique sentence-brand match
 * yields one BrandMention.
 *
 * Match strategy:
 *  - name and aliases: case-insensitive, word-boundary regex
 *  - domain: case-insensitive substring (citations URLs use lowercase already)
 *
 * Dedup rule: a single sentence can produce multiple mentions if multiple
 * different match types fire (name + alias + domain), BUT we collapse
 * back-to-back identical name matches in the same sentence.
 */

import type {
  BrandMention,
  CompetitorMentionParsed,
  BrandInput,
  CompetitorInput,
  Sentiment,
} from "./types";
import { scoreSentiment } from "./sentiment";

// ─── Public API ─────────────────────────────────────────────────────────

export function extractBrandMentions(
  responseText: string,
  brand: BrandInput,
): BrandMention[] {
  if (!responseText || !brand.name) return [];

  const sentences = splitIntoSentences(responseText);
  const mentions: BrandMention[] = [];
  const seen = new Set<string>(); // dedup key: `${sentenceIdx}|${matchType}|${matchedText}`

  // Build the matchers in priority order (name > alias > domain)
  const matchers: Array<{ type: "name" | "alias" | "domain"; needle: string; regex: RegExp }> = [];
  matchers.push({ type: "name", needle: brand.name, regex: buildWordRegex(brand.name) });
  for (const alias of brand.aliases ?? []) {
    if (alias) matchers.push({ type: "alias", needle: alias, regex: buildWordRegex(alias) });
  }
  if (brand.domain) {
    matchers.push({
      type: "domain",
      needle: brand.domain,
      regex: buildDomainRegex(brand.domain),
    });
  }
  for (const od of brand.ownedDomains ?? []) {
    matchers.push({ type: "domain", needle: od, regex: buildDomainRegex(od) });
  }

  const taken: Array<[number, number]> = [];

  for (const { sentence, charOffset } of sentences) {
    let sentenceSentiment: Sentiment | null = null;

    for (const m of matchers) {
      const match = firstTextMatch(responseText, sentence, charOffset, m.regex, looksLikeDomain(m.needle), (match) =>
        // Skip name/alias matches that are part of a domain: alias "AcmeLighting"
        // should NOT match the "acmelighting" inside "acmelighting.com".
        (m.type === "name" || m.type === "alias") && isUrlSubstring(sentence, match),
      );
      if (!match) continue;

      // One mention per piece of text: the name and an alias (or alias and
      // domain) matching the same characters count once.
      const start = charOffset + (match.index ?? 0);
      const end = start + match[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);

      const dedupKey = `${charOffset}|${m.type}|${m.needle.toLowerCase()}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      // Score the sentence once and reuse
      sentenceSentiment ??= scoreSentiment(sentence);

      mentions.push({
        brandName: brand.name,
        matchedText: match[0],
        matchType: m.type,
        context: sentence.trim(),
        position: start,
        sentiment: sentenceSentiment,
      });
    }
  }

  return mentions;
}

/**
 * First match of `regex` in the sentence that is real text, not a link:
 * matches inside a URL ("[1] https://www.acme.com/…", "(https://…)") are
 * citations, not mentions. With `skipLinkLabel`, a match that is the visible
 * label of a markdown link ("[acme.com](https://…)") is a citation too.
 */
function firstTextMatch(
  text: string,
  sentence: string,
  charOffset: number,
  regex: RegExp,
  skipLinkLabel: boolean,
  reject: (m: RegExpMatchArray) => boolean,
): RegExpMatchArray | null {
  const global = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  for (const m of sentence.matchAll(global)) {
    const pos = charOffset + (m.index ?? 0);
    if (isInsideUrl(text, pos)) continue;
    if (skipLinkLabel && isLinkLabel(text, pos + m[0].length)) continue;
    if (reject(m)) continue;
    return m;
  }
  return null;
}

/** "acme.com" style needles (domains, or aliases that are domains). */
function looksLikeDomain(needle: string): boolean {
  return /^[^\s]+\.[a-z]{2,}$/i.test(needle);
}

/** True when `pos` falls inside an http(s) URL. */
export function isInsideUrl(text: string, pos: number): boolean {
  let i = pos;
  while (i > 0 && !/[\s(<"'[\]]/.test(text[i - 1]!)) i--;
  // The whitespace/bracket-delimited token containing `pos` starts with a scheme.
  return /^https?:\/\//i.test(text.slice(i, Math.max(pos, i + 8)));
}

/** True when the text right after `end` closes a markdown link label: "…](http". */
function isLinkLabel(text: string, end: number): boolean {
  return /^[^\s\]]{0,60}\]\(https?:/i.test(text.slice(end, end + 70));
}

/** True if a regex match is immediately followed by `.tld` (i.e. it's part of a domain). */
function isUrlSubstring(sentence: string, match: RegExpMatchArray): boolean {
  const idx = match.index ?? 0;
  const after = sentence.slice(idx + match[0].length, idx + match[0].length + 6);
  return /^\.[a-z]{2,5}(\b|\/|$)/i.test(after);
}

/**
 * List items an answer presents, with the entity each item is "about".
 *
 * An item counts for an entity only when the item STARTS with the
 * entity's name ("1. **Acme** – …", "- **[Acme](…)**", "- Acme: …"). A
 * name further into the item ("2. Compare prices, e.g. on Acme's site") is
 * a step that mentions it. Source lists ("[1] https://…") are not items.
 *
 *   numbered — "1. …", "2) …", "### 3. …": the only kind with a rank
 *   bold     — entries that start with a bold name: unordered, no rank
 *   bullet   — "- …" entries: unordered, no rank
 *
 * Lines that follow an item without a blank line, and indented lines,
 * belong to it; an unindented paragraph after a blank line ends the list.
 */
export type ListItemKind = "numbered" | "bold" | "bullet";
type ListItem = { start: number; end: number; lead: number; kind: ListItemKind; rank: number | null; runSize: number };

const NUMBERED_ITEM = /^[ \t]{0,3}(?:#{1,6}[ \t]*)?(?:\*\*)?(\d{1,2})[.)][ \t]+\S/;
const BOLD_ITEM = /^[ \t]{0,3}(?:[-*•][ \t]+)?\*\*[^\n]{2,300}?\*\*/;
const BULLET_ITEM = /^[ \t]{0,3}[-*•][ \t]+\S/;
/** Marker and formatting before an item's first word: "### 2. **[", "- **", "1) _". */
const ITEM_LEAD = /^[ \t]*(?:#{1,6}[ \t]*)?(?:[-*•][ \t]+)?(?:\*\*)?(?:\d{1,2}[.)][ \t]+)?[*_[ \t]*/;

export function listItems(text: string): ListItem[] {
  const out: ListItem[] = [];
  let run: Omit<ListItem, "runSize">[] = [];
  let kind: ListItemKind | null = null;
  let open: { start: number; lead: number; kind: ListItemKind; rank: number | null } | null = null;
  let offset = 0;
  let prevBlank = false;

  const closeItem = (end: number) => {
    if (open) run.push({ ...open, end });
    open = null;
  };
  const closeRun = (end: number) => {
    closeItem(end);
    // A numbered "list" of one item is not an ordering.
    for (const it of run) out.push({ ...it, rank: it.kind === "numbered" && run.length >= 2 ? it.rank : null, runSize: run.length });
    run = [];
    kind = null;
  };

  for (const line of text.split("\n")) {
    const num = line.match(NUMBERED_ITEM);
    const lineKind: ListItemKind | null = num ? "numbered" : BOLD_ITEM.test(line) ? "bold" : BULLET_ITEM.test(line) ? "bullet" : null;
    const blank = line.trim() === "";
    const indented = /^[ \t]{2,}\S/.test(line);
    if (lineKind && !(open && indented)) {
      if (kind !== lineKind) closeRun(offset);
      else closeItem(offset);
      kind = lineKind;
      open = {
        start: offset,
        lead: offset + (line.match(ITEM_LEAD)?.[0].length ?? 0),
        kind: lineKind,
        rank: num ? Number(num[1]) : null,
      };
    } else if (open && !blank && prevBlank && !indented) {
      closeRun(offset);
    }
    prevBlank = blank;
    offset += line.length + 1;
  }
  closeRun(offset);
  return out;
}

/** The list item that starts with an entity mentioned at one of `positions`, if any. */
export function optionItemFor(text: string, positions: number[]): ListItem | null {
  if (!text || positions.length === 0) return null;
  const items = listItems(text);
  let best: ListItem | null = null;
  for (const pos of positions) {
    const item = items.find((it) => pos >= it.lead && pos <= it.lead + 1);
    if (!item) continue;
    if (!best || (item.rank ?? Infinity) < (best.rank ?? Infinity)) best = item;
  }
  return best;
}

/**
 * Rank = the entity's number in a numbered list of options it heads.
 * Unordered lists (bold entries, bullets) have no rank. Null otherwise.
 */
export function computeListRank(text: string, positions: number[]): number | null {
  return optionItemFor(text, positions)?.rank ?? null;
}

/** Rank of the brand's mentions; see computeListRank. */
export function computeBrandRankPosition(mentions: BrandMention[], text = ""): number | null {
  return computeListRank(text, mentions.map((m) => m.position));
}

/**
 * Same logic but for competitors. Returns one CompetitorMentionParsed per
 * (sentence, competitor) match.
 */
export function extractCompetitorMentions(
  responseText: string,
  competitors: CompetitorInput[],
): CompetitorMentionParsed[] {
  if (!responseText || competitors.length === 0) return [];

  const sentences = splitIntoSentences(responseText);
  const mentions: CompetitorMentionParsed[] = [];
  const seen = new Set<string>();

  const allMatchers = competitors.flatMap((c) => {
    const m: Array<{ name: string; needle: string; regex: RegExp }> = [
      { name: c.name, needle: c.name, regex: buildWordRegex(c.name) },
    ];
    for (const a of c.aliases ?? []) m.push({ name: c.name, needle: a, regex: buildWordRegex(a) });
    if (c.domain) m.push({ name: c.name, needle: c.domain, regex: buildDomainRegex(c.domain) });
    return m;
  });

  for (const { sentence, charOffset } of sentences) {
    let sentenceSentiment: Sentiment | null = null;

    for (const m of allMatchers) {
      const match = firstTextMatch(responseText, sentence, charOffset, m.regex, looksLikeDomain(m.needle), () => false);
      if (!match) continue;
      const dedupKey = `${charOffset}|${m.name}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      sentenceSentiment ??= scoreSentiment(sentence);
      mentions.push({
        competitorName: m.name,
        matchedText: match[0],
        context: sentence.trim(),
        position: charOffset + (match.index ?? 0),
        sentiment: sentenceSentiment,
      });
    }
  }

  return mentions;
}

// ─── Helpers ────────────────────────────────────────────────────────────

type SentenceSlice = { sentence: string; charOffset: number };

/**
 * Split text into sentences while preserving character offsets.
 *
 * Strategy:
 *  - For Latin terminators (. ! ?), require the terminator be followed by
 *    whitespace OR end-of-string. This avoids splitting on domain dots
 *    (e.g. "Visit acmelighting.com for details." stays as one sentence).
 *  - For CJK terminators (。！？), no whitespace check — Chinese sentences
 *    have no inter-sentence spaces.
 *  - Newline always ends a sentence.
 *  - Trailing fragments without a terminator are captured at end-of-string.
 *
 * Why not a regex .split()? We need character offsets so mentions can
 * report their absolute position in the original text.
 */
export function splitIntoSentences(text: string): SentenceSlice[] {
  const slices: SentenceSlice[] = [];
  // Lazy match any chars up to a sentence boundary:
  //   - CJK terminator (always counts)
  //   - Latin terminator followed by whitespace or EOF
  //   - newline
  //   - end of string (catches trailing fragment)
  const sentenceRegex = /[^\n]+?(?:[。！？]+|[.!?]+(?=\s|$)|\n|$)/g;

  let match: RegExpExecArray | null;
  while ((match = sentenceRegex.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.replace(/^\s+/, "");
    if (trimmed.trim().length === 0) continue;
    const offset = match.index + (raw.length - trimmed.length);
    slices.push({ sentence: trimmed, charOffset: offset });
  }

  return slices;
}

/**
 * Build a case-insensitive regex that matches `needle` as a whole word.
 * Escapes regex metacharacters in needle.
 *
 * Word boundary handling for CJK: \b doesn't work well with Chinese, so for
 * needles containing CJK chars we drop the boundary and rely on substring.
 */
function buildWordRegex(needle: string): RegExp {
  const escaped = escapeRegExp(needle);
  const hasCJK = /[\u4e00-\u9fff]/.test(needle);
  if (hasCJK) {
    return new RegExp(escaped, "i");
  }
  return new RegExp(`\\b${escaped}\\b`, "i");
}

function buildDomainRegex(domain: string): RegExp {
  const escaped = escapeRegExp(domain);
  return new RegExp(escaped, "i");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
