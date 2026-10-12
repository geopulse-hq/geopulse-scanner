import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validateConfig } from "../src/config";
import { demoScan, DEMO_CONFIG } from "../src/demo";
import { computeMetrics, toCsv, toHtml } from "../src/report";
import { estimateUsd, planCalls, redactSecrets } from "../src/scan";

test("a full scan is 10 questions × 2 engines × 2 samples", () => {
  const calls = planCalls(DEMO_CONFIG);
  assert.equal(calls.length, 40);
  assert.ok(estimateUsd(calls) > 0.5 && estimateUsd(calls) < 1.5);
});

test("demo answers go through the real rules: recommended, named only, cited, search not run", () => {
  const scan = demoScan();
  const m = computeMetrics(scan);
  // 24 recommendation answers, one OpenAI answer without completed search → not in the denominator
  assert.deepEqual([m.provider.recommended, m.provider.valid], [8, 23]);
  assert.deepEqual([m.research.cited, m.research.valid], [5, 16]);
  assert.deepEqual(m.failures, { searchNotExecuted: 1, error: 0, notRun: 0 });
  // "named in a forum, not confirmed" is a mention, never a recommendation
  const namedOnly = scan.answers.find((a) => a.questionIndex === 0 && a.engine === "perplexity" && a.sample === 2)!;
  assert.deepEqual([namedOnly.named, namedOnly.recommended, namedOnly.mentionType], [true, false, "mentioned"]);
  // each recommendation carries the rule and the text it fired on
  for (const a of scan.answers.filter((x) => x.recommended)) assert.ok(a.recommendationRule && a.recommendationSnippet);
});

test("report escapes answer text and keeps the demo banner", () => {
  const scan = demoScan();
  scan.answers[0]!.responseText = `<script>alert(1)</script>`;
  const html = toHtml(scan);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Demo report."));
  assert.equal(toCsv(scan).trim().split("\n").length, 41);
});

test("config validation explains what is wrong", () => {
  assert.throws(() => validateConfig({ brand: { name: "X" }, market: {}, questions: [] }), /brand\.domain is required[\s\S]*market\.country[\s\S]*at least one question/);
  assert.throws(
    () => validateConfig({ brand: { name: "X", domain: "x.com" }, market: { country: "us", language: "en" }, questions: [{ text: "q", intent: "ranking" }] }),
    /intent must be/,
  );
  const ok = validateConfig({ brand: { name: "X", domain: "https://www.X.com/about" }, market: { country: "US", language: "EN" }, questions: [{ text: " q ", intent: "research_citation" }] });
  assert.deepEqual([ok.brand.domain, ok.market.country, ok.questions[0]!.text], ["x.com", "us", "q"]);
});

test("API keys never reach a report through error messages", () => {
  process.env.OPENAI_API_KEY = "sk-test-0123456789abcdef";
  const msg = redactSecrets('Headers.append: "Bearer sk-test-0123456789abcdef" is an invalid header value; pplx-abcdefgh12345678');
  assert.ok(!msg.includes("sk-test-0123456789abcdef") && !msg.includes("pplx-abcdefgh12345678"));
  delete process.env.OPENAI_API_KEY;
});
