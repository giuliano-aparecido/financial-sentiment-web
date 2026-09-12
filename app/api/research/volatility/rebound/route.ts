import { NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { guardBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

// Reads the latest scheduled scan result (financial-sentiment-api's
// app/services/scheduler.py runs this daily, no longer live on request -
// see that repo's README for why). A cheap, single indexed DB read on the
// backend, not a scan - so no /start-style background job or polling
// needed here, unlike ../start and ../status (which are kept as a manual
// override, not called by the page anymore for this table).
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RESEARCH_RESULT_WINDOW_MS = 60_000;
const RESEARCH_RESULT_MAX_REQUESTS = 30;

export async function GET() {
  const guard = await guardBackendRequest({
    isAllowed: isResearchAllowed,
    rateLimit: { keyPrefix: 'research-rebound-result', windowMs: RESEARCH_RESULT_WINDOW_MS, maxRequests: RESEARCH_RESULT_MAX_REQUESTS },
  });
  if (guard instanceof NextResponse) return guard;

  return fetchUpstreamJson('/api/research/volatility/rebound', {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 10_000,
    backendLabel: 'research',
  });
}
