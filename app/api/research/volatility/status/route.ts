import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { isResearchAllowed } from '@/lib/researchAccess';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_API_KEY = process.env.RAG_API_KEY;

// Cheap on the backend (an in-memory dict read - see research_job.py) and
// meant to be polled every few seconds while a scan is running, so this
// gets a much looser budget than the start route's 1/5minutes - just
// enough to stop a runaway/misbehaving poll loop, not to bound normal use.
const RESEARCH_STATUS_WINDOW_MS = 60_000;
const RESEARCH_STATUS_MAX_REQUESTS = 30;

export async function GET() {
  if (!RAG_API_URL || !RAG_API_KEY) {
    return NextResponse.json({ error: 'Server is not configured.' }, { status: 500 });
  }

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

  if (!checkRateLimit(`research-status:${session.user.email}`, RESEARCH_STATUS_WINDOW_MS, RESEARCH_STATUS_MAX_REQUESTS)) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
  }

  try {
    const upstream = await fetch(`${RAG_API_URL}/api/research/volatility/status`, {
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
