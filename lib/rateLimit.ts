const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 10;

const buckets = new Map<string, { count: number; resetAt: number }>();

// Best-effort only: this is in-memory, per-process state. On Vercel each
// serverless instance has its own memory, and a cold start wipes it, so a
// determined caller can get more than maxRequests by landing on different
// instances. It's a courtesy limit for one signed-in user's own mistakes
// (e.g. an accidental double-click loop), not a security boundary - the
// backend API's own global rate limit is the real backstop, and matters
// more for the research routes specifically than for /api/analyze: a
// research scan fans out to a yfinance call per ticker across the whole
// universe, not one inference call, so a bypass here is far more
// expensive there than on /api/analyze.
export function checkRateLimit(
  key: string,
  windowMs: number = DEFAULT_WINDOW_MS,
  maxRequests: number = DEFAULT_MAX_REQUESTS_PER_WINDOW,
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= maxRequests) {
    return false;
  }

  bucket.count += 1;
  return true;
}
