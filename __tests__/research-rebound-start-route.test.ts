import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}));

import { getServerSession } from 'next-auth';

const AUTHED_SESSION = { user: { email: 'user@example.com' } };

describe('POST /api/research/volatility/rebound/start', () => {
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
    const { POST } = await import('../app/api/research/volatility/rebound/start/route');
    const response = await POST();
    expect(response.status).toBe(500);
  });

  it('returns 401 when there is no session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const { POST } = await import('../app/api/research/volatility/rebound/start/route');
    const response = await POST();
    expect(response.status).toBe(401);
  });

  it('returns 404 when the session email is not the research-allowed one', async () => {
    process.env.ALLOWED_EMAILS_RESEARCH = 'someone-else@example.com';
    const { POST } = await import('../app/api/research/volatility/rebound/start/route');
    const response = await POST();
    expect(response.status).toBe(404);
  });

  it('passes through the upstream error status and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'busy' }), { status: 503 })),
    );
    const { POST } = await import('../app/api/research/volatility/rebound/start/route');
    const response = await POST();
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toBe('busy');
  });

  it('maps a TimeoutError to 504', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    );
    const { POST } = await import('../app/api/research/volatility/rebound/start/route');
    const response = await POST();
    expect(response.status).toBe(504);
  });

  it('returns the upstream JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'running', started_at: 'now' }), { status: 200 })),
    );
    const { POST } = await import('../app/api/research/volatility/rebound/start/route');
    const response = await POST();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('running');
  });

  it('does not append any query params and hits the rebound/start endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'running' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await import('../app/api/research/volatility/rebound/start/route');
    await POST();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rag-api.example.com/api/research/volatility/rebound/start',
      expect.anything(),
    );
  });

  it('allows rapid repeated calls with no business rate-limit cooldown', async () => {
    // Regression guard: this route used to have its own "1/5minutes"
    // checkRateLimit cooldown, which blocked a genuinely new request
    // (nothing running) - removed at the user's explicit request, see
    // the route's own comment. Single-flight on the backend is now the
    // only protection against duplicate scans.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'running' }), { status: 200 })));
    const { POST } = await import('../app/api/research/volatility/rebound/start/route');
    for (let i = 0; i < 3; i++) {
      const response = await POST();
      expect(response.status).toBe(200);
    }
  });
});
