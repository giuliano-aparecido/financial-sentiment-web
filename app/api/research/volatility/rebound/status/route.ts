import { NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { guardBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

// Cheap on the backend (an in-memory dict read - see research_job.py) and
// meant to be polled every few seconds while a scan is running, so this
// gets a much looser budget than a per-scan cooldown would - just enough
// to stop a runaway/misbehaving poll loop, not to bound normal use.
const RESEARCH_STATUS_WINDOW_MS = 60_000;
const RESEARCH_STATUS_MAX_REQUESTS = 30;

export async function GET() {
  const guard = await guardBackendRequest({
    isAllowed: isResearchAllowed,
    rateLimit: { keyPrefix: 'research-rebound-status', windowMs: RESEARCH_STATUS_WINDOW_MS, maxRequests: RESEARCH_STATUS_MAX_REQUESTS },
  });
  if (guard instanceof NextResponse) return guard;

  return fetchUpstreamJson('/api/research/volatility/rebound/status', {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 10_000,
    backendLabel: 'research',
  });
}
