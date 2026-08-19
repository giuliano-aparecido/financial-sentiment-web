import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isResearchAllowed } from '@/lib/researchAccess';

// Same shape as ../rebound/retry/route.ts - see its own comment. No
// threshold_pct needed here: a retry always recovers tickers for every
// threshold in one shared run (financial-sentiment-api's scheduler.
// trigger_indicator_retry), unlike ../start which requires one just for
// contract consistency with the GET route.
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_API_KEY = process.env.RAG_API_KEY;

export async function POST() {
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

  try {
    const upstream = await fetch(`${RAG_API_URL}/api/research/volatility/indicator/retry`, {
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
