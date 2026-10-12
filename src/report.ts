/**
 * Report numbers — the same definitions as the GeoPulse Cloud report:
 *
 *   Recommendation rate = recommendation-question answers that present the
 *                         brand as an option to choose ÷ valid answers to
 *                         recommendation questions
 *   Citation rate       = knowledge-question answers that cite the brand's
 *                         own site ÷ valid answers to knowledge questions
 *
 * Only valid answers (status "ok") are in a denominator. Calls that failed,
 * weren't made, or where OpenAI's required web search didn't run are listed
 * as failures — never counted as "not mentioned". A valid answer that
 * doesn't mention the brand is a real zero.
 */
import type { AnswerRecord, ScanResult } from "./scan";

export type Counts = { valid: number; recommended: number; named: number; cited: number; failed: number };
export type Metrics = {
  provider: Counts & { rate: number | null };
  research: Counts & { rate: number | null };
  byEngine: Record<string, { provider: Counts & { rate: number | null }; research: Counts & { rate: number | null } }>;
  failures: { searchNotExecuted: number; error: number; notRun: number };
  competitors: Array<{ name: string; recommendedAnswers: number; namedAnswers: number }>;
  planned: number;
};

const empty = (): Counts => ({ valid: 0, recommended: 0, named: 0, cited: 0, failed: 0 });

function count(answers: AnswerRecord[]): Counts {
  const c = empty();
  for (const a of answers) {
    if (a.status !== "ok") {
      c.failed++;
      continue;
    }
    c.valid++;
    if (a.recommended) c.recommended++;
    if (a.named) c.named++;
    if (a.cited) c.cited++;
  }
  return c;
}

const withRate = (c: Counts, hit: "recommended" | "cited") => ({ ...c, rate: c.valid > 0 ? c[hit] / c.valid : null });

export function computeMetrics(scan: ScanResult): Metrics {
  const provider = scan.answers.filter((a) => a.intent === "provider_discovery");
  const research = scan.answers.filter((a) => a.intent === "research_citation");
  const byEngine: Metrics["byEngine"] = {};
  for (const e of scan.protocol.engines) {
    byEngine[e.engine] = {
      provider: withRate(count(provider.filter((a) => a.engine === e.engine)), "recommended"),
      research: withRate(count(research.filter((a) => a.engine === e.engine)), "cited"),
    };
  }
  const comp = new Map<string, { recommendedAnswers: number; namedAnswers: number }>();
  for (const a of provider) {
    if (a.status !== "ok") continue;
    for (const n of a.competitorsNamed) {
      const row = comp.get(n) ?? { recommendedAnswers: 0, namedAnswers: 0 };
      row.namedAnswers++;
      if (a.competitorsRecommended.includes(n)) row.recommendedAnswers++;
      comp.set(n, row);
    }
  }
  return {
    provider: withRate(count(provider), "recommended"),
    research: withRate(count(research), "cited"),
    byEngine,
    failures: {
      searchNotExecuted: scan.answers.filter((a) => a.status === "search_not_executed").length,
      error: scan.answers.filter((a) => a.status === "error").length,
      notRun: scan.answers.filter((a) => a.status === "not_run").length,
    },
    competitors: [...comp.entries()]
      .map(([name, r]) => ({ name, ...r }))
      .sort((x, y) => y.recommendedAnswers - x.recommendedAnswers || y.namedAnswers - x.namedAnswers),
    planned: scan.answers.length,
  };
}

// ─── CSV ───────────────────────────────────────────────────────────────

export function toCsv(scan: ScanResult): string {
  const cols = [
    "question_no", "intent", "question", "engine", "model", "sample", "status", "search_executed",
    "recommended", "named", "own_site_cited", "outcome", "rule", "competitors_recommended", "citations", "error",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = scan.answers.map((a) => [
    a.questionIndex + 1, a.intent, a.question, a.engine, a.model ?? a.requestedModel, a.sample, a.status, a.searchExecuted ?? "",
    a.recommended, a.named, a.cited, a.mentionType ?? "", a.recommendationRule ?? "", a.competitorsRecommended.join("; "),
    a.citations.map((c) => c.url).join(" "), a.error ? `${a.error.code}: ${a.error.message}` : "",
  ]);
  return [cols, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

// ─── HTML ──────────────────────────────────────────────────────────────

/** GeoPulse Cloud link with the campaign tags from the launch plan (no personal data). */
export const CLOUD_URL = "https://smrtgeo.com/?utm_source=github&utm_medium=referral&utm_campaign=oss-launch&utm_content=report-footer";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

function outcome(a: AnswerRecord): { cls: string; label: string } {
  if (a.status === "search_not_executed") return { cls: "fail", label: "Search didn't run — not counted" };
  if (a.status === "error") return { cls: "fail", label: `Failed (${a.error?.code ?? "error"}) — not counted` };
  if (a.status === "not_run") return { cls: "fail", label: `Not run (${a.error?.code ?? "skipped"}) — not counted` };
  if (a.negative) return { cls: "neg", label: "Named with negative wording" };
  if (a.intent === "provider_discovery") {
    if (a.recommended) return { cls: "hit", label: "Recommended as an option" };
    if (a.named) return { cls: "part", label: "Named, not presented as an option" };
    if (a.cited) return { cls: "part", label: "Your site cited, brand not named" };
    return { cls: "miss", label: "Not mentioned" };
  }
  if (a.cited) return { cls: "hit", label: "Your site cited" };
  if (a.named) return { cls: "part", label: "Named, your site not cited" };
  return { cls: "miss", label: "Not cited" };
}

function metricCard(title: string, hit: number, valid: number, rate: number | null, hint: string): string {
  return `<div class="card metric"><div class="mlabel">${esc(title)}</div><div class="mvalue">${hit}<span>/${valid}</span></div><div class="mrate">${pct(rate)}</div><p>${esc(hint)}</p></div>`;
}

function answerBlock(a: AnswerRecord): string {
  const o = outcome(a);
  const cites = a.citations.length
    ? `<ol class="cites">${a.citations
        .map((c) => `<li class="${c.owned ? "own" : ""}"><a href="${esc(c.url)}" rel="noopener noreferrer" target="_blank">${esc(c.domain || c.url)}</a>${c.owned ? ' <b>your site</b>' : ""}${c.origin === "text_link" ? " <i>(link in answer text)</i>" : ""}</li>`)
        .join("")}</ol>`
    : `<p class="muted">No citations returned.</p>`;
  const why = a.recommendationRule
    ? `<p class="why"><b>Why it counts:</b> rule <code>${esc(a.recommendationRule)}</code> — “${esc(a.recommendationSnippet ?? "")}”</p>`
    : "";
  const comps = a.competitorsRecommended.length ? `<p class="muted">Competitors recommended: ${esc(a.competitorsRecommended.join(", "))}</p>` : "";
  return `<details class="answer ${o.cls}">
  <summary><span class="dot"></span><span class="eng">${esc(a.engine === "openai" ? "OpenAI" : a.engine === "perplexity" ? "Perplexity" : a.engine)} · sample ${a.sample}</span><span class="out">${esc(o.label)}</span></summary>
  <div class="body">
    <p class="muted">Model run: ${esc(a.model ?? "—")} (requested ${esc(a.requestedModel)}) · web search: ${esc(a.searchExecuted ?? "—")}${a.queriedAt ? ` · ${esc(a.queriedAt.slice(0, 16).replace("T", " "))} UTC` : ""}</p>
    ${why}${comps}
    ${a.error ? `<p class="err">${esc(a.error.message)}</p>` : `<div class="text">${esc(a.responseText)}</div>`}
    <h4>Citations</h4>${cites}
  </div>
</details>`;
}

export function toHtml(scan: ScanResult): string {
  const m = computeMetrics(scan);
  const c = scan.config;
  const byQ = c.questions.map((q, i) => ({ q, i, answers: scan.answers.filter((a) => a.questionIndex === i) }));
  const failures = m.failures.searchNotExecuted + m.failures.error + m.failures.notRun;
  const engineRows = scan.protocol.engines
    .map((e) => {
      const r = m.byEngine[e.engine]!;
      return `<tr><td>${esc(e.label)}</td><td>${r.provider.recommended}/${r.provider.valid} <span class="muted">${pct(r.provider.rate)}</span></td><td>${r.research.cited}/${r.research.valid} <span class="muted">${pct(r.research.rate)}</span></td></tr>`;
    })
    .join("");
  const compRows = m.competitors.length
    ? `<table><thead><tr><th>Name</th><th>Answers recommending</th><th>Answers naming</th></tr></thead><tbody>${m.competitors
        .map((r) => `<tr><td>${esc(r.name)}</td><td>${r.recommendedAnswers}</td><td>${r.namedAnswers}</td></tr>`)
        .join("")}<tr class="you"><td>${esc(c.brand.name)} (you)</td><td>${m.provider.recommended}</td><td>${m.provider.named}</td></tr></tbody></table><p class="muted">Within ${m.provider.valid} valid answers to recommendation questions; each answer counts once per name.</p>`
    : `<p class="muted">No competitors configured.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI visibility report · ${esc(c.brand.name)}</title>
<style>
:root{--bg:#fff;--fg:#14121a;--muted:#6b6878;--line:#e7e5ee;--card:#faf9fd;--brand:#5420C8;--hit:#0f8a5f;--hitbg:#e6f6ef;--part:#a16207;--partbg:#fdf3dc;--miss:#b4233a;--missbg:#fbe9ec;--fail:#6b6878;--failbg:#f0eff4}
@media (prefers-color-scheme:dark){:root{--bg:#121118;--fg:#ecebf2;--muted:#9a97a8;--line:#2a2833;--card:#1a1922;--brand:#8b6cf0;--hitbg:#0f2a20;--hit:#4fd1a1;--partbg:#2c2410;--part:#f0c060;--missbg:#2c1218;--miss:#f08a9a;--failbg:#24232b;--fail:#9a97a8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:36px 0 12px}h3{font-size:15px;margin:0 0 10px}h4{font-size:13px;margin:14px 0 6px;color:var(--muted)}
.muted{color:var(--muted);font-size:13px}.banner{background:var(--partbg);color:var(--part);border-radius:10px;padding:10px 14px;margin:16px 0;font-size:14px}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:20px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.metric .mlabel{font-size:13px;color:var(--muted)}.metric .mvalue{font-size:34px;font-weight:700;font-variant-numeric:tabular-nums}.metric .mvalue span{font-size:16px;color:var(--muted);font-weight:500}.metric .mrate{font-weight:600;color:var(--brand)}.metric p{margin:6px 0 0;font-size:12px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}th{font-size:12px;color:var(--muted);font-weight:600}tr.you td{font-weight:600}
.tablewrap{overflow-x:auto}.q{margin-bottom:14px}.q .meta{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}.tag{font-size:11px;border-radius:6px;padding:2px 7px;background:var(--failbg);color:var(--muted)}.tag.pd{background:#efe9fd;color:#5420C8}@media (prefers-color-scheme:dark){.tag.pd{background:#2a2142;color:#b9a5ff}}
details.answer{border:1px solid var(--line);border-radius:10px;margin:6px 0;background:var(--bg)}details.answer summary{cursor:pointer;list-style:none;display:flex;gap:10px;align-items:center;padding:9px 12px;font-size:14px}details.answer summary::-webkit-details-marker{display:none}
.dot{width:9px;height:9px;border-radius:50%;flex:none}.hit .dot{background:var(--hit)}.part .dot{background:var(--part)}.miss .dot,.neg .dot{background:var(--miss)}.fail .dot{background:var(--fail)}
.eng{color:var(--muted);min-width:150px}.out{font-weight:500}.hit .out{color:var(--hit)}.part .out{color:var(--part)}.miss .out,.neg .out{color:var(--miss)}.fail .out{color:var(--fail)}
.body{padding:0 14px 14px;border-top:1px solid var(--line)}.text{white-space:pre-wrap;font-size:14px;background:var(--card);border-radius:8px;padding:12px;margin-top:10px;max-height:420px;overflow:auto}
.cites{margin:0;padding-left:20px;font-size:13px}.cites li.own a{color:var(--hit);font-weight:600}.cites a{color:var(--brand);word-break:break-all}.why{font-size:13px}.err{color:var(--miss);font-size:13px}code{font-size:12px}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}footer a{color:var(--brand)}
@media (max-width:560px){.eng{min-width:0}details.answer summary{flex-wrap:wrap}}
</style>
</head>
<body><main>
<p class="muted">AI visibility report</p>
<h1>${esc(c.brand.name)}</h1>
<p class="muted">${esc(c.brand.domain)} · market ${esc(c.market.country.toUpperCase())} / ${esc(c.market.language)} · ${esc(scan.startedAt.slice(0, 10))}</p>
${scan.demo ? `<div class="banner"><b>Demo report.</b> Brand, site and answers are fictitious sample data — no API was called. Run your own scan to see real answers.</div>` : ""}
<div class="metrics">
${metricCard("Recommendation questions — answers that list you as an option", m.provider.recommended, m.provider.valid, m.provider.rate, "Answers to “who / what should I choose” questions that present your brand as a choice.")}
${metricCard("Knowledge questions — answers that cite your site", m.research.cited, m.research.valid, m.research.rate, "Answers to “how / what / why” questions that cite a page on your own domain.")}
</div>
<p class="muted">${m.planned} answers planned · ${m.provider.valid + m.research.valid} valid${failures ? ` · ${failures} not counted (search didn't run ${m.failures.searchNotExecuted}, failed ${m.failures.error}, not run ${m.failures.notRun})` : ""} · API cost ${scan.demo ? "none (demo)" : `≈ $${scan.costUsd.toFixed(4)}`}</p>

<h2>By engine</h2>
<div class="tablewrap"><table><thead><tr><th>Engine</th><th>Recommended</th><th>Site cited</th></tr></thead><tbody>${engineRows}</tbody></table></div>

<h2>Competitors in recommendation answers</h2>
<div class="tablewrap">${compRows}</div>

<h2>Every question, every answer</h2>
<p class="muted">Open an answer to read the full text and its sources. Each question was asked ${scan.protocol.samplesPerQuestion}× per engine.</p>
${byQ
  .map(
    ({ q, i, answers }) => `<div class="card q"><div class="meta"><span class="tag ${q.intent === "provider_discovery" ? "pd" : ""}">${q.intent === "provider_discovery" ? "recommendation question" : "knowledge question"}</span><span class="muted">#${i + 1}</span></div><h3>${esc(q.text)}</h3>${answers.map(answerBlock).join("")}</div>`,
  )
  .join("\n")}

<h2>What this is — and isn't</h2>
<ul class="muted">
<li>A snapshot of these ${c.questions.length} fixed questions, sent through the ${scan.protocol.engines.map((e) => esc(e.label)).join(" and ")} APIs on this date. It is not a ranking inside the consumer ChatGPT or Perplexity apps, and not what every user sees.</li>
<li>Each request contained only the question and neutral instructions (protocol v1, ${esc(scan.protocol.systemPromptVersion)}) — never your brand, site or competitors.</li>
<li>Answers vary between runs. Compare two reports only when the questions, engines, models and instructions are the same.</li>
</ul>

<footer>
Generated by <b>geopulse-scanner</b> v${esc(scan.tool.version)} (MIT) · protocol v1 · ${esc(scan.finishedAt.slice(0, 16).replace("T", " "))} UTC<br>
Want saved history, comparisons between runs and no setup? <a href="${CLOUD_URL}" rel="noopener">GeoPulse Cloud</a>.
</footer>
</main></body></html>
`;
}
