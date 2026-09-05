import { NextRequest, NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { guardBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

// Reads the latest scheduled scan result for one threshold_pct - see
// ../rebound/route.ts's own comment for why this is a plain read now,
// not a scan trigger (financial-sentiment-api's scheduler.py runs this
// monthly, for all three thresholds, off one shared discovery pass).
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RESEARCH_RESULT_WINDOW_MS = 60_000;
const RESEARCH_RESULT_MAX_REQUESTS = 30;

const ALLOWED_THRESHOLD_PCTS = new Set(['2', '3', '5']);

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest({
    isAllowed: isResearchAllowed,
    rateLimit: { keyPrefix: 'research-indicator-result', windowMs: RESEARCH_RESULT_WINDOW_MS, maxRequests: RESEARCH_RESULT_MAX_REQUESTS },
  });
  if (guard instanceof NextResponse) return guard;

  const thresholdParam = request.nextUrl.searchParams.get('threshold_pct');
  if (!thresholdParam || !ALLOWED_THRESHOLD_PCTS.has(thresholdParam)) {
    return NextResponse.json(
      { error: 'threshold_pct must be one of 2, 3, or 5.' },
      { status: 400 },
    );
  }

  return fetchUpstreamJson(`/api/research/volatility/indicator?threshold_pct=${thresholdParam}`, {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 10_000,
    backendLabel: 'research',
  });
}
