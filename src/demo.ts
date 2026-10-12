/**
 * Demo scan — fictitious brand, sites and answers (reserved .example
 * domains), no API calls. The made-up raw answers go through the same
 * reading rules as a real scan, so the demo report shows exactly how real
 * answers are judged: recommended, named only, not mentioned, own site
 * cited, and an answer whose required web search didn't run.
 */
import type { QueryResult } from "./core/adapters/types";
import { FULL_REPORT_ENGINES, SAMPLES_PER_PROMPT, SYSTEM_PROMPT_VERSION } from "./core/services/protocol";
import { validateConfig, type ScanConfig } from "./config";
import { engineLabel, planCalls, toRecord, TOOL_VERSION, type ScanResult } from "./scan";

export const DEMO_CONFIG: ScanConfig = validateConfig({
  brand: { name: "Northwind Lamps", domain: "northwind-lamps.example" },
  market: { country: "us", language: "en" },
  competitors: [
    { name: "Brightline Lighting", domain: "brightline-lighting.example" },
    { name: "Lumenhaus", domain: "lumenhaus.example" },
  ],
  questions: [
    { intent: "provider_discovery", text: "Which brands make energy-efficient LED floor lamps for home offices?" },
    { intent: "provider_discovery", text: "Where can I buy dimmable LED desk lamps with a long warranty in the US?" },
    { intent: "provider_discovery", text: "What are good alternatives to cheap imported LED lamps for a small hotel?" },
    { intent: "provider_discovery", text: "Which lighting manufacturers supply custom LED fixtures for restaurants?" },
    { intent: "provider_discovery", text: "What is a reliable online store for architectural LED lighting?" },
    { intent: "provider_discovery", text: "Who sells LED lamps with a CRI above 95 for art studios?" },
    { intent: "research_citation", text: "How long do LED lamps actually last compared with the rated hours?" },
    { intent: "research_citation", text: "What does CRI mean when buying LED lighting?" },
    { intent: "research_citation", text: "Is it safe to leave LED lamps on overnight?" },
    { intent: "research_citation", text: "How do I choose the right color temperature for a home office?" },
  ],
});

type Outcome = "rec" | "named" | "none" | "cited" | "searchfail";

// Per question: [openai #1, openai #2, perplexity #1, perplexity #2]
const GRID: Outcome[][] = [
  ["rec", "rec", "rec", "named"],
  ["none", "rec", "none", "none"],
  ["none", "none", "none", "none"],
  ["named", "none", "rec", "rec"],
  ["rec", "searchfail", "none", "rec"],
  ["none", "none", "named", "none"],
  ["cited", "none", "cited", "cited"],
  ["none", "none", "none", "cited"],
  ["none", "none", "none", "none"],
  ["named", "cited", "none", "none"],
];

const OWN = "https://northwind-lamps.example";
const BRIGHT = "**Brightline Lighting** — makes dimmable LED panels and floor lamps for offices. Website: https://brightline-lighting.example";
const LUMEN = "**Lumenhaus** — supplies high-CRI LED fixtures to studios and hotels. Website: https://lumenhaus.example";
const OTHER = "**Harbor & Pine Lighting** — sells budget LED desk lamps online. Website: https://harbor-pine.example";

function providerText(o: Outcome, i: number): { text: string; urls: string[] } {
  const ours = `**Northwind Lamps** — makes architectural LED lamps with a five-year warranty. Website: ${OWN}`;
  if (o === "rec") {
    const items = i % 2 === 0 ? [BRIGHT, ours, LUMEN] : [ours, LUMEN, OTHER];
    return {
      text: `Based on current public sources, these are relevant options:\n\n${items.map((s, n) => `${n + 1}. ${s}`).join("\n")}\n\nCompare warranty terms and color-rendering specs before you buy.`,
      urls: ["https://lighting-review.example/best-led-2026", `${OWN}/warranty`, "https://brightline-lighting.example"],
    };
  }
  if (o === "named") {
    return {
      text: `Options that come up most often:\n\n1. ${BRIGHT}\n2. ${LUMEN}\n\nSome forum threads also discuss Northwind Lamps, but I couldn't confirm current stock or pricing from reliable sources, so it isn't listed above.`,
      urls: ["https://lighting-forum.example/thread/4821", "https://lumenhaus.example"],
    };
  }
  return {
    text: `Relevant candidates from public sources:\n\n1. ${BRIGHT}\n2. ${OTHER}\n3. ${LUMEN}\n\nCheck return policies and certifications (UL / ETL) before ordering.`,
    urls: ["https://lighting-review.example/best-led-2026", "https://harbor-pine.example", "https://lumenhaus.example"],
  };
}

const RESEARCH: Record<number, string> = {
  6: "Rated LED lifetimes (often 25,000–50,000 hours) describe when light output falls to 70% (L70), not when the lamp stops working. Heat is the main factor: enclosed fixtures shorten real-world life considerably.",
  7: "CRI (Color Rendering Index) measures how accurately a light source shows colors compared with a reference light, on a 0–100 scale. For homes, CRI 90+ is a good target; for art and photography, look for 95+ and check the R9 (deep red) value.",
  8: "Quality LED lamps run cool and draw little power, so leaving them on overnight is generally safe. Use lamps certified by a recognised testing lab and avoid covering them or using them in enclosed fixtures not rated for LEDs.",
  9: "For a home office, 4000–5000 K (neutral to cool white) supports alertness during the day, while 2700–3000 K is better in the evening. A dimmable, tunable lamp lets you change between them.",
};

function researchText(o: Outcome, qi: number): { text: string; urls: string[] } {
  const base = RESEARCH[qi] ?? "";
  if (o === "cited") {
    return { text: `${base} [1][2]`, urls: ["https://energy-guide.example/led-basics", `${OWN}/guides/led-lifespan-explained`] };
  }
  if (o === "named") {
    return { text: `${base} Retailers such as Northwind Lamps publish their own test data, but independent measurements are more reliable. [1]`, urls: ["https://energy-guide.example/led-basics"] };
  }
  return { text: `${base} [1][2]`, urls: ["https://energy-guide.example/led-basics", "https://lighting-review.example/explainers"] };
}

export function demoScan(): ScanResult {
  const config = DEMO_CONFIG;
  const at = new Date("2026-10-12T09:00:00Z");
  const answers = planCalls(config).map((call) => {
    const slot = FULL_REPORT_ENGINES.indexOf(call.engine) * SAMPLES_PER_PROMPT + (call.sample - 1);
    const o = GRID[call.questionIndex]![slot]!;
    const q = config.questions[call.questionIndex]!;
    const { text, urls } = q.intent === "provider_discovery" ? providerText(o, call.questionIndex) : researchText(o, call.questionIndex);
    const result: QueryResult = {
      engine: call.engine.engine,
      responseText: text,
      citations: urls.map((url, n) => ({ url, domain: new URL(url).hostname.replace(/^www\./, ""), position: n + 1 })),
      rawResponse: null,
      cached: false,
      queriedAt: at,
      audit: {
        provider: call.engine.engine,
        requestedModel: call.engine.model,
        model: call.engine.engine === "openai" ? "gpt-4o-mini-2024-07-18" : "sonar",
        startedAt: at.toISOString(),
        searchPolicy: call.engine.searchPolicy,
        searchExecuted: o === "searchfail" ? "false" : call.engine.engine === "openai" ? "true" : "unknown",
        searchCalls: [],
        sourceUrls: urls,
        costUsd: 0,
        costBasis: "estimate",
        costNote: "demo — no API call",
      },
    };
    return toRecord(config, call, result);
  });
  return {
    tool: { name: "geopulse-scanner", version: TOOL_VERSION },
    protocol: {
      version: "v1",
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      samplesPerQuestion: SAMPLES_PER_PROMPT,
      engines: FULL_REPORT_ENGINES.map(({ engine, model, searchPolicy }) => ({ engine, model, searchPolicy, label: engineLabel(engine) })),
    },
    config,
    startedAt: at.toISOString(),
    finishedAt: at.toISOString(),
    costUsd: 0,
    demo: true,
    answers,
  };
}
