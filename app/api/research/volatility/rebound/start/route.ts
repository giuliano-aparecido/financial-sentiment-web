import { NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { guardBackendRequest, fetchUpstreamJson } from '@/lib/backendProxy';

// The backend scan itself takes 1-3 minutes, but this route only has to
// wait for the backend's own POST .../rebound/start to return, which is
// immediate (it kicks off a background job and responds right away -
// see financial-sentiment-api's app/services/research_job.py). No need
// for a long maxDuration here the way /api/analyze needs one for its
// own synchronous HF inference call.
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

// No checkRateLimit cooldown here as of 2026-08-19 (previously a
// "research:" 1-per-5-minutes bucket) - removed at the user's explicit
// request: "user can start a new scan as long there is no scan of it
// running" - a flat time-window cooldown was blocking exactly that. The
// real protection against wasted duplicate yfinance calls is the
// backend's own single-flight-per-scan-type behavior (see
// financial-sentiment-api's research_job.py and app/routers/research.py,
// which dropped the matching backend-side override for the same
// reason) - calling .../rebound/start while a rebound scan is already
// running just returns its in-flight status, no new scan actually
// starts.
export async function POST() {
  const guard = await guardBackendRequest({ isAllowed: isResearchAllowed });
  if (guard instanceof NextResponse) return guard;

  return fetchUpstreamJson('/api/research/volatility/rebound/start', {
    method: 'POST',
    timeoutMs: 10_000,
    backendLabel: 'research',
    slowWakeHint: true,
  });
}
