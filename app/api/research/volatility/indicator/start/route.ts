import { NextRequest, NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { authorizeBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

// Entirely separate route from ../rebound/start and ../today/start -
// this table has its own independent Refresh button + threshold
// selector, backed by its own job/cache on the backend (see financial-
// sentiment-api's research_job.py module docstring for why it's a
// genuinely separate job). Same "kicks off a background job and
// responds right away" shape as the other /start routes, so the same
// short maxDuration applies.
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const ALLOWED_THRESHOLD_PCTS = new Set(['2', '3', '5']);

export async function POST(request: NextRequest) {
  const guard = await authorizeBackendRequest({ isAllowed: isResearchAllowed });
  if (guard instanceof NextResponse) return guard;

  // Validated here too, not just trusted to match the frontend's own
  // <select> options and re-validated server-side by the backend - a
  // malformed/tampered value should fail fast with a clear 400 rather
  // than reaching the backend and burning part of its own rate-limit
  // budget on a request that was always going to 422.
  const thresholdParam = request.nextUrl.searchParams.get('threshold_pct');
  if (!thresholdParam || !ALLOWED_THRESHOLD_PCTS.has(thresholdParam)) {
    return NextResponse.json(
      { error: 'threshold_pct must be one of 2, 3, or 5.' },
      { status: 400 },
    );
  }

  return fetchUpstreamJson(`/api/research/volatility/indicator/start?threshold_pct=${thresholdParam}`, {
    method: 'POST',
    timeoutMs: 10_000,
    backendLabel: 'research',
    slowWakeHint: true,
  });
}
