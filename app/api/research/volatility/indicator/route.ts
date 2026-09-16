import { NextRequest, NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { authorizeBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';
import { THRESHOLD_OPTION_STRINGS } from '@/lib/volatilityThresholds';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RESEARCH_RESULT_WINDOW_MS = 60_000;
const RESEARCH_RESULT_MAX_REQUESTS = 30;

const ALLOWED_THRESHOLD_PCTS = new Set(THRESHOLD_OPTION_STRINGS);

export async function GET(request: NextRequest) {
  const guard = await authorizeBackendRequest({
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
