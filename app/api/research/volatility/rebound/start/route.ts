import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isResearchAllowed } from '@/lib/researchAccess';

// The backend scan itself takes 1-3 minutes, but this route only has to
// wait for the backend's own POST .../rebound/start to return, which is
// immediate (it kicks off a background job and responds right away -
// see financial-sentiment-api's app/services/research_job.py). No need
// for a long maxDuration here the way /api/analyze needs one for its
// own synchronous HF inference call.
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_API_KEY = process.env.RAG_API_KEY;

// No checkRateLimit cooldown here as of 2026-08-19 (previously a
// "research:" 1-per-5-minutes bucket) - removed at the user's explicit
// request: "user can start a new scan as long there is no scan of it
// running" - a flat time-window cooldown was blocking exactly that. The
// real protection against wasted duplicate yfinance calls is the
// backend's own single-flight-per-scan-type behavior (see
// financial-sentiment-api's research_job.py and app/routers/research.py,
// which dropped the matching backend-side override for the same
// reason) - calling .../rebound/start while a rebound scan is already
// running just returns its in-flight status, no new scan actually
// starts.
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

  try {
    const upstream = await fetch(`${RAG_API_URL}/api/research/volatility/rebound/start`, {
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
