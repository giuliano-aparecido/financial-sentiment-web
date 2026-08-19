import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {},
  isAllowedEmail: vi.fn(() => true),
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: vi.fn(() => true),
}));

import { getServerSession } from 'next-auth';
import { isAllowedEmail } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';

const AUTHED_SESSION = { user: { email: 'user@example.com' } };

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/analyze', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/analyze', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.RAG_API_URL = 'https://rag-api.example.com';
    process.env.RAG_API_KEY = 'test-rag-key';
    vi.mocked(getServerSession).mockResolvedValue(AUTHED_SESSION as never);
    vi.mocked(checkRateLimit).mockReturnValue(true);
    vi.mocked(isAllowedEmail).mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns 500 when RAG_API_URL/RAG_API_KEY are not configured', async () => {
    delete process.env.RAG_API_URL;
    const { POST } = await import('../app/api/analyze/route');
    const response = await POST(makeRequest({ user_query: 'AAPL' }));
    expect(response.status).toBe(500);
  });

  it('returns 401 when there is no session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const { POST } = await import('../app/api/analyze/route');
    const response = await POST(makeRequest({ user_query: 'AAPL' }));
    expect(response.status).toBe(401);
  });

  it('returns 404 when the session email is not in ALLOWED_EMAILS (e.g. a research-only email)', async () => {
    vi.mocked(isAllowedEmail).mockReturnValue(false);
    const { POST } = await import('../app/api/analyze/route');
    const response = await POST(makeRequest({ user_query: 'AAPL' }));
    expect(response.status).toBe(404);
  });

  it('returns 429 when the rate limit is exceeded', async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false);
    const { POST } = await import('../app/api/analyze/route');
    const response = await POST(makeRequest({ user_query: 'AAPL' }));
    expect(response.status).toBe(429);
  });

  it('returns 400 for an empty user_query', async () => {
    const { POST } = await import('../app/api/analyze/route');
    const response = await POST(makeRequest({ user_query: '   ' }));
    expect(response.status).toBe(400);
  });

  it('returns 400 for an oversized user_query', async () => {
    const { POST } = await import('../app/api/analyze/route');
    const response = await POST(makeRequest({ user_query: 'a'.repeat(2001) }));
    expect(response.status).toBe(400);
  });

  it('passes through the upstream error status and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'bad ticker' }), { status: 422 })),
    );
    const { POST } = await import('../app/api/analyze/route');
    const response = await POST(makeRequest({ user_query: 'AAPL' }));
    expect(response.status).toBe(422);
    const data = await response.json();
    expect(data.error).toBe('bad ticker');
  });

  it('maps a TimeoutError to 504', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    );
    const { POST } = await import('../app/api/analyze/route');
    const response = await POST(makeRequest({ user_query: 'AAPL' }));
    expect(response.status).toBe(504);
  });

  it('returns the upstream JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ticker: 'AAPL', predicted_direction: 'BULLISH' }), { status: 200 }),
        ),
    );
    const { POST } = await import('../app/api/analyze/route');
    const response = await POST(makeRequest({ user_query: 'AAPL' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ticker).toBe('AAPL');
  });
});
