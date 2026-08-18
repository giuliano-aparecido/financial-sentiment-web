import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { isResearchAllowed } from '@/lib/researchAccess';

// The backend scan itself takes 1-3 minutes, but this route only has to
// wait for the backend's own POST /start to return, which is immediate
// (it kicks off a background job and responds right away - see
// financial-sentiment-api's app/services/research_job.py). No need for a
// long maxDuration here the way /api/analyze needs one for its own
// synchronous HF inference call.
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_API_KEY = process.env.RAG_API_KEY;

// Deliberately much stricter than /api/analyze's per-user budget: a full
// scan makes ~150+ calls to Yahoo's unofficial endpoints on the backend,
// so repeatedly triggering new scans (not just polling status - see the
// status route's own limit) risks getting the backend's IP rate-limited
// by Yahoo, which would break /api/analyze for every user, not just this
// page. The backend has its own matching 1/5minutes backstop (see
// financial-sentiment-api's app/routers/research.py) - this is the same
// policy enforced per-user here too, rather than relying on the
// backend's global limit alone to catch a single user hammering Refresh.
const RESEARCH_START_WINDOW_MS = 5 * 60_000;
const RESEARCH_START_MAX_REQUESTS = 1;

export async function POST() {
  if (!RAG_API_URL || !RAG_API_KEY) {
    return NextResponse.json({ error: 'Server is not configured.' }, { status: 500 });
  }

  // The proxy matcher is what actually gates this route today, but that's
  // one regex edit away from silently exposing an endpoint that can
  // trigger an expensive backend scan - check the session here too, same
  // defense-in-depth as /api/analyze.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // /research is restricted to one owner email, separately from the
  // general ALLOWED_EMAILS allowlist that let this session sign in at all
  // - see lib/researchAccess.ts and proxy.ts's own copy of this check.
  if (!isResearchAllowed(session.user.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // "research:"-prefixed key so this budget is independent of
  // /api/analyze's own per-user bucket (same checkRateLimit call, same
  // Map, different key -> different bucket).
  if (!checkRateLimit(`research:${session.user.email}`, RESEARCH_START_WINDOW_MS, RESEARCH_START_MAX_REQUESTS)) {
    return NextResponse.json(
      { error: 'A scan was already started recently. Please wait a few minutes before starting another.' },
      { status: 429 },
    );
  }

  try {
    const upstream = await fetch(`${RAG_API_URL}/api/research/volatility/start`, {
      method: 'POST',
      headers: { 'X-API-Key': RAG_API_KEY },
      signal: AbortSignal.timeout(10_000),
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
        { error: 'The research backend took too long to respond. It may be waking up from idle - try again shortly.' },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: 'Failed to reach the research backend.' }, { status: 502 });
  }
}
