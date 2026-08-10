const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 10;

const buckets = new Map<string, { count: number; resetAt: number }>();

// Best-effort only: this is in-memory, per-process state. On Vercel each
// serverless instance has its own memory, and a cold start wipes it, so a
// determined caller can get more than maxRequests by landing on different
// instances. It's a courtesy limit for one signed-in user's own mistakes
// (e.g. an accidental double-click loop), not a security boundary - the
// backend API has its own global rate limit as the real backstop (see
// app/api/research/small-caps/start/route.ts's comment for why that
// backstop is especially important for the research scan specifically).
//
// windowMs/maxRequests are optional so every existing call site (just
// /api/analyze today) keeps its original 10-per-60s behavior unchanged;
// pass a different key AND different limits together for an independent
// budget (see app/api/research/small-caps/*/route.ts, which use a
// "research:"-prefixed key precisely so their budget doesn't share a
// bucket with /api/analyze's).
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
