// Scanner shim: no usage ledger (the scanner never calls Anthropic).
export async function logAnthropicUsage(..._args: unknown[]): Promise<void> {}
