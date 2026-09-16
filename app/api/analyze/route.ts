import { NextRequest, NextResponse } from 'next/server';
import { isAllowedEmail } from '@/lib/auth';
import { authorizeBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

// The API's own inference call can take up to 280s against the Modal scale-to-zero backend;
// 300 is Vercel Hobby's actual hard cap - the 290s fetch timeout below aborts just under that
// ceiling so this route returns a clean 504 instead of Vercel hard-killing it mid-request.
export const maxDuration = 300;

// Matches the upstream API's own QueryRequest max_length.
const MAX_QUERY_LENGTH = 2000;

export async function POST(request: NextRequest) {
  // No keyPrefix: deliberately shares the default rate-limit bucket rather than
  // an unset one (see lib/rateLimit.ts).
  const guard = await authorizeBackendRequest({ isAllowed: isAllowedEmail, rateLimit: {} });
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

  const model = request.nextUrl.searchParams.get('model') || 'llama';
  const backendUrl = `/api/analyze?model=${encodeURIComponent(model)}`;

  return fetchUpstreamJson(backendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_query: userQuery }),
    timeoutMs: 290_000,
    backendLabel: 'analysis',
    slowWakeHint: true,
  });
}
