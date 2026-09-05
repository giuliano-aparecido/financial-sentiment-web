import { NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { guardBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

// Same shape as ../rebound/retry/route.ts - see its own comment. No
// threshold_pct needed here: a retry always recovers tickers for every
// threshold in one shared run (financial-sentiment-api's scheduler.
// trigger_indicator_retry), unlike ../start which requires one just for
// contract consistency with the GET route.
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function POST() {
  const guard = await guardBackendRequest({ isAllowed: isResearchAllowed });
  if (guard instanceof NextResponse) return guard;

  return fetchUpstreamJson('/api/research/volatility/indicator/retry', {
    method: 'POST',
    timeoutMs: 10_000,
    backendLabel: 'research',
    slowWakeHint: true,
  });
}
