// GENERATED from GeoPulse src/types/index.ts by scripts/export-scanner-core.mjs — do not edit here.
/**
 * Shared application types.
 *
 * Engine-specific types live in src/server/adapters/types.ts.
 */

export type Country = string; // ISO 3166-1 alpha-2 (e.g. "US", "CN", "GB")
export type Language = string; // ISO 639-1 (e.g. "en", "zh", "es")

export type EngineName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "perplexity"
  | "google-ai-overviews"
  | "bing-copilot"
  | "grok";

export type Plan = "free" | "starter" | "pro" | "business";

export type ScanStatus = "pending" | "running" | "completed" | "failed";
