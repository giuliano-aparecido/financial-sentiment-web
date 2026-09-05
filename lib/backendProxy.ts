import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';

export const RAG_API_URL = process.env.RAG_API_URL;
export const RAG_API_KEY = process.env.RAG_API_KEY;

interface RateLimitOptions {
  keyPrefix?: string;
  windowMs?: number;
  maxRequests?: number;
}

interface GuardOptions {
  isAllowed: (email: string) => boolean;
  rateLimit?: RateLimitOptions;
}

// Returns the caller's email on success, or the NextResponse to return
// immediately on failure - check `instanceof NextResponse` at the call site.
//
// The session/allowlist checks here are defense-in-depth, not the only
// gate: proxy.ts's own matcher-based check is what actually blocks
// unauthenticated/disallowed requests to these routes today, but that's
// one regex edit away from silently exposing an endpoint that can trigger
// an expensive backend scan or spend paid inference quota - re-checking
// here means a proxy.ts regression can't expose these routes on its own.
export async function guardBackendRequest({ isAllowed, rateLimit }: GuardOptions): Promise<{ email: string } | NextResponse> {
  if (!RAG_API_URL || !RAG_API_KEY) {
    return NextResponse.json({ error: 'Server is not configured.' }, { status: 500 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAllowed(session.user.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (rateLimit) {
    const key = rateLimit.keyPrefix ? `${rateLimit.keyPrefix}:${session.user.email}` : session.user.email;
    if (!checkRateLimit(key, rateLimit.windowMs, rateLimit.maxRequests)) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }
  }

  return { email: session.user.email };
}

interface FetchUpstreamOptions {
  method: 'GET' | 'POST';
  timeoutMs: number;
  backendLabel: string;
  slowWakeHint?: boolean;
  cache?: RequestCache;
  headers?: Record<string, string>;
  body?: string;
}

export async function fetchUpstreamJson(path: string, opts: FetchUpstreamOptions): Promise<NextResponse> {
  try {
    const upstream = await fetch(`${RAG_API_URL}${path}`, {
      method: opts.method,
      headers: { 'X-API-Key': RAG_API_KEY!, ...opts.headers },
      cache: opts.cache,
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const upstreamError = data as { error?: string; detail?: string } | null;
      return NextResponse.json(
        { error: upstreamError?.error || upstreamError?.detail || `Upstream returned status ${upstream.status}` },
        { status: upstream.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      const hint = opts.slowWakeHint ? ' It may be waking up from idle - try again shortly.' : '';
      return NextResponse.json(
        { error: `The ${opts.backendLabel} backend took too long to respond.${hint}` },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: `Failed to reach the ${opts.backendLabel} backend.` }, { status: 502 });
  }
}
