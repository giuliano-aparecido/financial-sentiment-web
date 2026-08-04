const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

const buckets = new Map<string, { count: number; resetAt: number }>();

// Best-effort only: this is in-memory, per-process state. On Vercel each
// serverless instance has its own memory, and a cold start wipes it, so a
// determined caller can get more than MAX_REQUESTS_PER_WINDOW by landing on
// different instances. It's a courtesy limit for one signed-in user's own
// mistakes (e.g. an accidental double-click loop), not a security boundary -
// the RAG API has its own global rate limit as the real backstop.
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  bucket.count += 1;
  return true;
}
