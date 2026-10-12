/**
 * Scan input: one brand, one market, up to 10 questions.
 *
 * The questions are sent to the engines exactly as written — the brand,
 * domain and competitors are only used afterwards, to read the answers.
 */
import { readFileSync } from "node:fs";
import { MAX_PROMPTS, type PromptIntent } from "./core/services/protocol";

export type ScanConfig = {
  brand: { name: string; domain: string; aliases?: string[]; ownedDomains?: string[] };
  market: { country: string; language: string };
  competitors?: Array<{ name: string; domain?: string; aliases?: string[] }>;
  questions: Array<{ text: string; intent: PromptIntent }>;
};

const INTENTS: PromptIntent[] = ["provider_discovery", "research_citation"];

export function loadConfig(path: string): ScanConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Cannot read ${path}: ${(err as Error).message}`);
  }
  return validateConfig(raw);
}

export function validateConfig(raw: unknown): ScanConfig {
  const problems: string[] = [];
  const c = raw as Partial<ScanConfig>;
  if (!c?.brand?.name?.trim()) problems.push("brand.name is required");
  if (!c?.brand?.domain?.trim()) problems.push("brand.domain is required (e.g. example.com)");
  if (!c?.market?.country?.trim()) problems.push('market.country is required (e.g. "us")');
  if (!c?.market?.language?.trim()) problems.push('market.language is required (e.g. "en")');
  const qs = Array.isArray(c?.questions) ? c.questions : [];
  if (qs.length === 0) problems.push("questions: add at least one question");
  if (qs.length > MAX_PROMPTS) problems.push(`questions: at most ${MAX_PROMPTS} (got ${qs.length})`);
  qs.forEach((q, i) => {
    if (!q?.text?.trim()) problems.push(`questions[${i}].text is empty`);
    if (!INTENTS.includes(q?.intent as PromptIntent)) {
      problems.push(`questions[${i}].intent must be "provider_discovery" (who/what to choose) or "research_citation" (how/what/why)`);
    }
  });
  if (problems.length) throw new Error(`Invalid scan config:\n  - ${problems.join("\n  - ")}`);
  return {
    brand: {
      name: c.brand!.name.trim(),
      domain: normalizeDomain(c.brand!.domain),
      aliases: c.brand!.aliases ?? [],
      ownedDomains: (c.brand!.ownedDomains ?? []).map(normalizeDomain),
    },
    market: { country: c.market!.country.trim().toLowerCase(), language: c.market!.language.trim().toLowerCase() },
    competitors: (c.competitors ?? []).map((x) => ({ ...x, domain: x.domain ? normalizeDomain(x.domain) : undefined })),
    questions: qs.map((q) => ({ text: q.text.trim(), intent: q.intent })),
  };
}

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}
