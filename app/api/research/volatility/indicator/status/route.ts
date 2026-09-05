import { NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { guardBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

// Same loose polling budget as ../../status/route.ts - see that file's
// own comment. Own bucket key so polling this table doesn't compete with
// the main scan's status polling.
const RESEARCH_INDICATOR_STATUS_WINDOW_MS = 60_000;
const RESEARCH_INDICATOR_STATUS_MAX_REQUESTS = 30;

export async function GET() {
  const guard = await guardBackendRequest({
    isAllowed: isResearchAllowed,
    rateLimit: { keyPrefix: 'research-indicator-status', windowMs: RESEARCH_INDICATOR_STATUS_WINDOW_MS, maxRequests: RESEARCH_INDICATOR_STATUS_MAX_REQUESTS },
  });
  if (guard instanceof NextResponse) return guard;

  return fetchUpstreamJson('/api/research/volatility/indicator/status', {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 10_000,
    backendLabel: 'research',
  });
}
