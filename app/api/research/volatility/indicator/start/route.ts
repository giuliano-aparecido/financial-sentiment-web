import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isResearchAllowed } from '@/lib/researchAccess';

// Entirely separate route from ../rebound/start and ../today/start -
// this table has its own independent Refresh button + threshold
// selector, backed by its own job/cache on the backend (see financial-
// sentiment-api's research_job.py module docstring for why it's a
// genuinely separate job). Same "kicks off a background job and
// responds right away" shape as the other /start routes, so the same
// short maxDuration applies.
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_API_KEY = process.env.RAG_API_KEY;

// No checkRateLimit cooldown here as of 2026-08-19 (previously a
// "research-indicator:" 1-per-5-minutes bucket) - see ../rebound/start/
// route.ts's own comment for the full reasoning (removed at the user's
// explicit request; single-flight on the backend is the real
// protection). Matters especially here: the user explicitly wants to be
// able to start a new scan immediately after changing the threshold,
// which a flat per-user cooldown would have blocked regardless of
// whether the threshold actually changed.

const ALLOWED_THRESHOLD_PCTS = new Set(['2', '3', '5']);

export async function POST(request: NextRequest) {
  if (!RAG_API_URL || !RAG_API_KEY) {
    return NextResponse.json({ error: 'Server is not configured.' }, { status: 500 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isResearchAllowed(session.user.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Validated here too, not just trusted to match the frontend's own
  // <select> options and re-validated server-side by the backend - a
  // malformed/tampered value should fail fast with a clear 400 rather
  // than reaching the backend and burning part of its own rate-limit
  // budget on a request that was always going to 422.
  const thresholdParam = request.nextUrl.searchParams.get('threshold_pct');
  if (!thresholdParam || !ALLOWED_THRESHOLD_PCTS.has(thresholdParam)) {
    return NextResponse.json(
      { error: 'threshold_pct must be one of 2, 3, or 5.' },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(
      `${RAG_API_URL}/api/research/volatility/indicator/start?threshold_pct=${thresholdParam}`,
      {
        method: 'POST',
        headers: { 'X-API-Key': RAG_API_KEY },
        signal: AbortSignal.timeout(10_000),
      },
    );

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
