import { NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { authorizeBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const RESEARCH_RESULT_WINDOW_MS = 60_000;
const RESEARCH_RESULT_MAX_REQUESTS = 30;

export async function GET() {
  const guard = await authorizeBackendRequest({
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
