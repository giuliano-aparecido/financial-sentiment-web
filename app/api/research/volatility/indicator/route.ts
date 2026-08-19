import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { isResearchAllowed } from '@/lib/researchAccess';

// Reads the latest scheduled scan result for one threshold_pct - see
// ../rebound/route.ts's own comment for why this is a plain read now,
// not a scan trigger (financial-sentiment-api's scheduler.py runs this
// monthly, for all three thresholds, off one shared discovery pass).
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_API_KEY = process.env.RAG_API_KEY;

const RESEARCH_RESULT_WINDOW_MS = 60_000;
const RESEARCH_RESULT_MAX_REQUESTS = 30;

const ALLOWED_THRESHOLD_PCTS = new Set(['2', '3', '5']);

export async function GET(request: NextRequest) {
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

  if (!checkRateLimit(`research-indicator-result:${session.user.email}`, RESEARCH_RESULT_WINDOW_MS, RESEARCH_RESULT_MAX_REQUESTS)) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
  }

  const thresholdParam = request.nextUrl.searchParams.get('threshold_pct');
  if (!thresholdParam || !ALLOWED_THRESHOLD_PCTS.has(thresholdParam)) {
    return NextResponse.json(
      { error: 'threshold_pct must be one of 2, 3, or 5.' },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(
      `${RAG_API_URL}/api/research/volatility/indicator?threshold_pct=${thresholdParam}`,
      {
        method: 'GET',
        headers: { 'X-API-Key': RAG_API_KEY },
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
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
        { error: 'The research backend took too long to respond.' },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: 'Failed to reach the research backend.' }, { status: 502 });
  }
}
