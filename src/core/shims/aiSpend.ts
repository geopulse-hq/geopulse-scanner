// GENERATED from GeoPulse src/server/services/aiSpend.ts (price constants + openAiCostUsd only) by scripts/export-scanner-core.mjs — do not edit here.
const OPENAI_MINI_IN = 0.15;
const OPENAI_MINI_OUT = 0.6;
const OPENAI_SEARCH_CALL = 0.01;

export function openAiCostUsd(inputTokens: number, outputTokens: number, searchCalls: number): number {
  return (inputTokens * OPENAI_MINI_IN + outputTokens * OPENAI_MINI_OUT) / 1_000_000 + searchCalls * OPENAI_SEARCH_CALL;
}
