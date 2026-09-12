import { NextRequest, NextResponse } from 'next/server';
import { isAllowedEmail } from '@/lib/auth';
import { guardBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

// The API's own inference call can take up to 280s against the Modal
// scale-to-zero backend - a real cold start alone measured ~120s live, well
// past what a 45s/60s budget here assumed (that was sized for the old
// always-warm HF Inference Endpoint / Colab tunnel). 300 is Vercel Hobby's
// actual hard cap (with Fluid Compute) - see the 290s timeout below for
// why this route's own fetch aborts a little before that ceiling instead of
// letting Vercel hard-kill the function mid-request.
export const maxDuration = 300;

// Matches the API's own QueryRequest max_length - reject oversized bodies
// here instead of forwarding them and letting the upstream 422 do the work.
const MAX_QUERY_LENGTH = 2000;

export async function POST(request: NextRequest) {
  // No keyPrefix: this route intentionally shares the default rate-limit
  // bucket (session email alone), kept separate from each volatility
  // route's own "research-*"-prefixed bucket - see lib/rateLimit.ts.
  const guard = await guardBackendRequest({ isAllowed: isAllowedEmail, rateLimit: {} });
  if (guard instanceof NextResponse) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const userQuery = (body as { user_query?: unknown } | null)?.user_query;
  if (typeof userQuery !== 'string' || userQuery.trim().length === 0 || userQuery.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `user_query must be a non-empty string of at most ${MAX_QUERY_LENGTH} characters.` },
      { status: 400 },
    );
  }

  return fetchUpstreamJson('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_query: userQuery }),
    timeoutMs: 290_000,
    backendLabel: 'analysis',
    slowWakeHint: true,
  });
}
