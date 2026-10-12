// Scanner shim: API keys come from the user's own environment (.env).
const optional = (k: string): string | undefined => process.env[k] || undefined;
export const env = {
  OPENAI_API_KEY: () => optional("OPENAI_API_KEY"),
  PERPLEXITY_API_KEY: () => optional("PERPLEXITY_API_KEY"),
  // The scanner never calls Anthropic; lexicon sentiment only.
  ANTHROPIC_API_KEY: (): string | undefined => undefined,
};
