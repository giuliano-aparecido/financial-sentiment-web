import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}));

import { getServerSession } from 'next-auth';

const AUTHED_SESSION = { user: { email: 'user@example.com' } };

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/research/volatility/indicator/start${query}`, { method: 'POST' });
}

describe('POST /api/research/volatility/indicator/start', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.RAG_API_URL = 'https://rag-api.example.com';
    process.env.RAG_API_KEY = 'test-rag-key';
    process.env.ALLOWED_EMAILS_RESEARCH = AUTHED_SESSION.user.email;
    vi.mocked(getServerSession).mockResolvedValue(AUTHED_SESSION as never);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns 500 when RAG_API_URL/RAG_API_KEY are not configured', async () => {
    delete process.env.RAG_API_URL;
    const { POST } = await import('../app/api/research/volatility/indicator/start/route');
    const response = await POST(makeRequest('?threshold_pct=2'));
    expect(response.status).toBe(500);
  });

  it('returns 401 when there is no session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const { POST } = await import('../app/api/research/volatility/indicator/start/route');
    const response = await POST(makeRequest('?threshold_pct=2'));
    expect(response.status).toBe(401);
  });

  it('returns 404 when the session email is not the research-allowed one', async () => {
    process.env.ALLOWED_EMAILS_RESEARCH = 'someone-else@example.com';
    const { POST } = await import('../app/api/research/volatility/indicator/start/route');
    const response = await POST(makeRequest('?threshold_pct=2'));
    expect(response.status).toBe(404);
  });

  it('returns 400 when threshold_pct is missing', async () => {
    const { POST } = await import('../app/api/research/volatility/indicator/start/route');
    const response = await POST(makeRequest(''));
    expect(response.status).toBe(400);
  });

  it('returns 400 for a threshold_pct outside the allowed set', async () => {
    const { POST } = await import('../app/api/research/volatility/indicator/start/route');
    const response = await POST(makeRequest('?threshold_pct=4'));
    expect(response.status).toBe(400);
  });

  it('passes through the upstream error status and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'busy' }), { status: 503 })),
    );
    const { POST } = await import('../app/api/research/volatility/indicator/start/route');
    const response = await POST(makeRequest('?threshold_pct=2'));
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toBe('busy');
  });

  it('forwards the threshold_pct to the backend and returns its result', async () => {
    const fakeResult = { status: 'running' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(fakeResult), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await import('../app/api/research/volatility/indicator/start/route');
    const response = await POST(makeRequest('?threshold_pct=5'));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('threshold_pct=5'),
      expect.anything(),
    );
    const data = await response.json();
    expect(data).toEqual(fakeResult);
  });

  it('maps a TimeoutError to 504', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    );
    const { POST } = await import('../app/api/research/volatility/indicator/start/route');
    const response = await POST(makeRequest('?threshold_pct=2'));
    expect(response.status).toBe(504);
  });

  it('allows rapid repeated calls with no business rate-limit cooldown', async () => {
    // Regression guard, same as ../rebound/start's own equivalent test:
    // this table's own comment explains the cooldown was removed at the
    // user's explicit request so changing the threshold and refreshing
    // immediately isn't blocked.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'running' }), { status: 200 })));
    const { POST } = await import('../app/api/research/volatility/indicator/start/route');
    for (let i = 0; i < 3; i++) {
      const response = await POST(makeRequest('?threshold_pct=2'));
      expect(response.status).toBe(200);
    }
  });
});
