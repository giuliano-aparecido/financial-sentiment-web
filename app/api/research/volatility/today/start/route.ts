import { NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { guardBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

// See ../../rebound/start/route.ts for the full reasoning this mirrors
// (independent job on the backend, no time-window cooldown - single-
// flight is the real protection).
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function POST() {
  const guard = await guardBackendRequest({ isAllowed: isResearchAllowed });
  if (guard instanceof NextResponse) return guard;

  return fetchUpstreamJson('/api/research/volatility/today/start', {
    method: 'POST',
    timeoutMs: 10_000,
    backendLabel: 'research',
    slowWakeHint: true,
  });
}
