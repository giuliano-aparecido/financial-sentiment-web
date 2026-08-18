import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: vi.fn(() => true),
}));

import { getServerSession } from 'next-auth';
import { checkRateLimit } from '@/lib/rateLimit';

const AUTHED_SESSION = { user: { email: 'user@example.com' } };

describe('POST /api/research/volatility/start', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.RAG_API_URL = 'https://rag-api.example.com';
    process.env.RAG_API_KEY = 'test-rag-key';
    process.env.ALLOWED_EMAILS_RESEARCH = AUTHED_SESSION.user.email;
    vi.mocked(getServerSession).mockResolvedValue(AUTHED_SESSION as never);
    vi.mocked(checkRateLimit).mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns 500 when RAG_API_URL/RAG_API_KEY are not configured', async () => {
    delete process.env.RAG_API_URL;
    const { POST } = await import('../app/api/research/volatility/start/route');
    const response = await POST();
    expect(response.status).toBe(500);
  });

  it('returns 401 when there is no session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const { POST } = await import('../app/api/research/volatility/start/route');
    const response = await POST();
    expect(response.status).toBe(401);
  });

  it('returns 404 when the session email is not the research-allowed one', async () => {
    process.env.ALLOWED_EMAILS_RESEARCH = 'someone-else@example.com';
    const { POST } = await import('../app/api/research/volatility/start/route');
    const response = await POST();
    expect(response.status).toBe(404);
  });

  it('returns 429 when the rate limit is exceeded', async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false);
    const { POST } = await import('../app/api/research/volatility/start/route');
    const response = await POST();
    expect(response.status).toBe(429);
  });

  it('rate-limits with a research-prefixed key, not the shared /api/analyze bucket', async () => {
    const { POST } = await import('../app/api/research/volatility/start/route');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'running' }), { status: 200 })));
    await POST();
    expect(checkRateLimit).toHaveBeenCalledWith(
      `research:${AUTHED_SESSION.user.email}`,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('passes through the upstream error status and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'busy' }), { status: 503 })),
    );
    const { POST } = await import('../app/api/research/volatility/start/route');
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
    const { POST } = await import('../app/api/research/volatility/start/route');
    const response = await POST();
    expect(response.status).toBe(504);
  });

  it('returns the upstream JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'running', started_at: 'now' }), { status: 200 })),
    );
    const { POST } = await import('../app/api/research/volatility/start/route');
    const response = await POST();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('running');
  });

  it('does not append any query params to the upstream request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'running' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await import('../app/api/research/volatility/start/route');
    await POST();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rag-api.example.com/api/research/volatility/start',
      expect.anything(),
    );
  });
});
