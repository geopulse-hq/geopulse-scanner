#!/usr/bin/env node
/**
 *   npm run demo                         sample report from fictitious data (no API key)
 *   npm run init                         write scan.json to fill in
 *   npm run scan -- --config scan.json   real scan with your own API keys
 *
 * Options for scan: --out <dir>  --max-usd <n> (default 1.50)  --yes (skip the cost prompt)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config";
import { DEMO_CONFIG, demoScan } from "./demo";
import { computeMetrics, toCsv, toHtml } from "./report";
import { estimateUsd, planCalls, runScan, type ScanResult } from "./scan";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

/** Load KEY=value lines from ./.env without overriding the real environment. */
function loadDotEnv(): void {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

function write(scan: ScanResult, dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.html"), toHtml(scan));
  writeFileSync(join(dir, "report.json"), JSON.stringify(scan, null, 2));
  writeFileSync(join(dir, "answers.csv"), toCsv(scan));
  const m = computeMetrics(scan);
  const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
  console.log(`
  Recommendation questions: listed as an option in ${m.provider.recommended}/${m.provider.valid} valid answers (${pct(m.provider.rate)})
  Knowledge questions:      own site cited in      ${m.research.cited}/${m.research.valid} valid answers (${pct(m.research.rate)})
  Not counted: ${m.failures.searchNotExecuted} search didn't run · ${m.failures.error} failed · ${m.failures.notRun} not run

  Report: ${resolve(dir, "report.html")}
          ${resolve(dir, "report.json")}  ·  ${resolve(dir, "answers.csv")}
`);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

async function main(): Promise<void> {
  if (cmd === "demo") {
    write(demoScan(), opt("out") ?? "reports/demo");
    return;
  }

  if (cmd === "init") {
    const path = opt("config") ?? "scan.json";
    if (existsSync(path) && !flag("force")) throw new Error(`${path} already exists (use --force to overwrite)`);
    const example = { ...DEMO_CONFIG, brand: { name: "Your Brand", domain: "your-site.com", aliases: [] } };
    writeFileSync(path, JSON.stringify(example, null, 2) + "\n");
    console.log(`Wrote ${path}. Replace the brand, market, competitors and the 10 questions with your own, then: npm run scan -- --config ${path}`);
    return;
  }

  if (cmd === "run") {
    loadDotEnv();
    const configPath = opt("config") ?? "scan.json";
    const config = loadConfig(configPath);
    const calls = planCalls(config);
    const maxUsd = Number(opt("max-usd") ?? "1.5");
    if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("--max-usd must be a positive number");
    const missing = ["OPENAI_API_KEY", "PERPLEXITY_API_KEY"].filter((k) => !process.env[k]);
    console.log(`
  ${config.brand.name} (${config.brand.domain}) · ${config.market.country.toUpperCase()}/${config.market.language}
  ${config.questions.length} questions × 2 engines × 2 samples = ${calls.length} API calls
  Estimated cost: up to ≈ $${estimateUsd(calls).toFixed(2)} on your own API accounts (hard stop at --max-usd $${maxUsd.toFixed(2)})
  Each request contains only the question — never your brand, site or competitors.${missing.length ? `\n  Missing: ${missing.join(", ")} — those calls will be marked "not run".` : ""}
`);
    if (!flag("yes")) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question("  Start? [y/N] ")).trim().toLowerCase();
      rl.close();
      if (answer !== "y" && answer !== "yes") return console.log("  Cancelled — nothing was sent.");
    }
    const scan = await runScan(config, {
      maxUsd,
      onProgress: (done, total, last) => process.stdout.write(`\r  ${done}/${total} answers · last: ${last.engine} ${last.status}        `),
    });
    process.stdout.write("\n");
    write(scan, opt("out") ?? join("reports", `${config.brand.domain}-${stamp()}`));
    return;
  }

  console.log(`geopulse-scanner — is your brand recommended or your site cited in AI search answers?

  npm run demo                          sample report from fictitious data (no API key needed)
  npm run init                          create scan.json to fill in
  npm run scan -- --config scan.json    run a real scan with your own OpenAI + Perplexity keys
       options: --out <dir>  --max-usd <n> (default 1.50)  --yes`);
}

main().catch((err) => {
  console.error(`\n  ${(err as Error).message}\n`);
  process.exit(1);
});
