import { NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { guardBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

// Separate from ../start - that's always a full hard-refresh scan (see
// financial-sentiment-api's scheduler.py module docstring, revised at
// the user's explicit request to NOT have Refresh silently choose
// retry-vs-full on its own). This route retries ONLY the tickers that
// failed on the latest saved run - the frontend only shows the "Retry
// Failed Tickers" button that calls this when failed_ticker_count > 0.
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function POST() {
  const guard = await guardBackendRequest({ isAllowed: isResearchAllowed });
  if (guard instanceof NextResponse) return guard;

  return fetchUpstreamJson('/api/research/volatility/rebound/retry', {
    method: 'POST',
    timeoutMs: 10_000,
    backendLabel: 'research',
    slowWakeHint: true,
  });
}
