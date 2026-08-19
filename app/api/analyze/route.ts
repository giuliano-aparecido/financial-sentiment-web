import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAllowedEmail } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';

// The API's own inference call can take up to 280s against the Modal
// scale-to-zero backend - a real cold start alone measured ~120s live, well
// past what a 45s/60s budget here assumed (that was sized for the old
// always-warm HF Inference Endpoint / Colab tunnel). 300 is Vercel Hobby's
// actual hard cap (with Fluid Compute) - see AbortSignal.timeout below for
// why this route's own fetch aborts a little before that ceiling instead of
// letting Vercel hard-kill the function mid-request.
export const maxDuration = 300;

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_API_KEY = process.env.RAG_API_KEY;

// Matches the API's own QueryRequest max_length - reject oversized bodies
// here instead of forwarding them and letting the upstream 422 do the work.
const MAX_QUERY_LENGTH = 2000;

export async function POST(request: NextRequest) {
  if (!RAG_API_URL || !RAG_API_KEY) {
    return NextResponse.json({ error: 'Server is not configured.' }, { status: 500 });
  }

  // The middleware matcher is what actually gates this route today, but
  // that's one regex edit away from silently exposing an endpoint that
  // spends paid HF inference quota - check the session here too.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ALLOWED_EMAILS_RESEARCH is a separate allowlist from ALLOWED_EMAILS
  // (see lib/auth.ts's signIn callback) - a research-only session can
  // exist now, and this non-research route must not accept it, matching
  // proxy.ts's own non-research branch.
  if (!isAllowedEmail(session.user.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!checkRateLimit(session.user.email)) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
  }

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

  try {
    const upstream = await fetch(`${RAG_API_URL}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': RAG_API_KEY,
      },
      body: JSON.stringify({ user_query: userQuery }),
      // Above the API's own 280s inference timeout, under this route's
      // maxDuration above - so a hung upstream fails fast with a clear
      // message from this route's own catch block, instead of Vercel
      // hard-killing the function first with no message at all.
      signal: AbortSignal.timeout(290_000),
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const upstreamError = data as { error?: string; detail?: string } | null;
      return NextResponse.json(
        { error: upstreamError?.error || upstreamError?.detail || `Upstream returned status ${upstream.status}` },
        { status: upstream.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'The analysis backend took too long to respond. It may be waking up from idle - try again shortly.' },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: 'Failed to reach the analysis backend.' }, { status: 502 });
  }
}
