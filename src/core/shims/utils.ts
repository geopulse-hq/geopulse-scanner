// Scanner shim: helpers used by the (unused here) Claude sentiment path.
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
export async function withRetry<T>(fn: () => Promise<T>, options: { retries?: number; baseMs?: number; label?: string } = {}): Promise<T> {
  const { retries = 3, baseMs = 1000 } = options;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if ((err as { retryable?: boolean })?.retryable === false || attempt === retries) break;
      await sleep(baseMs * 2 ** attempt);
    }
  }
  throw last;
}
