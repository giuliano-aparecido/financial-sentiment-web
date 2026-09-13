import { NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { authorizeBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function POST() {
  // No rate-limit cooldown here - the backend's single-flight-per-scan-type
  // behavior is what actually prevents duplicate scans.
  const guard = await authorizeBackendRequest({ isAllowed: isResearchAllowed });
  if (guard instanceof NextResponse) return guard;

  return fetchUpstreamJson('/api/research/volatility/today/start', {
    method: 'POST',
    timeoutMs: 10_000,
    backendLabel: 'research',
    slowWakeHint: true,
  });
}
