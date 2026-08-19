import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { isResearchAllowed } from '@/lib/researchAccess';

// Reads the latest scheduled scan result (financial-sentiment-api's
// app/services/scheduler.py runs this daily, no longer live on request -
// see that repo's README for why). A cheap, single indexed DB read on the
// backend, not a scan - so no /start-style background job or polling
// needed here, unlike ../start and ../status (which are kept as a manual
// override, not called by the page anymore for this table).
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_API_KEY = process.env.RAG_API_KEY;

const RESEARCH_RESULT_WINDOW_MS = 60_000;
const RESEARCH_RESULT_MAX_REQUESTS = 30;

export async function GET() {
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

  if (!checkRateLimit(`research-rebound-result:${session.user.email}`, RESEARCH_RESULT_WINDOW_MS, RESEARCH_RESULT_MAX_REQUESTS)) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
  }

  try {
    const upstream = await fetch(`${RAG_API_URL}/api/research/volatility/rebound`, {
      method: 'GET',
      headers: { 'X-API-Key': RAG_API_KEY },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
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
        { error: 'The research backend took too long to respond.' },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: 'Failed to reach the research backend.' }, { status: 502 });
  }
}
