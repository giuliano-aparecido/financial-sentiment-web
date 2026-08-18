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

describe('GET /api/research/volatility/rebound/status', () => {
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
    const { GET } = await import('../app/api/research/volatility/rebound/status/route');
    const response = await GET();
    expect(response.status).toBe(500);
  });

  it('returns 401 when there is no session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const { GET } = await import('../app/api/research/volatility/rebound/status/route');
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('returns 404 when the session email is not the research-allowed one', async () => {
    process.env.ALLOWED_EMAILS_RESEARCH = 'someone-else@example.com';
    const { GET } = await import('../app/api/research/volatility/rebound/status/route');
    const response = await GET();
    expect(response.status).toBe(404);
  });

  it('returns 429 when the polling rate limit is exceeded', async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false);
    const { GET } = await import('../app/api/research/volatility/rebound/status/route');
    const response = await GET();
    expect(response.status).toBe(429);
  });

  it('uses a rebound-specific key, independent of the today/indicator status budgets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'idle' }), { status: 200 })));
    const { GET } = await import('../app/api/research/volatility/rebound/status/route');
    await GET();
    expect(checkRateLimit).toHaveBeenCalledWith(
      `research-rebound-status:${AUTHED_SESSION.user.email}`,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('maps a TimeoutError to 504', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    );
    const { GET } = await import('../app/api/research/volatility/rebound/status/route');
    const response = await GET();
    expect(response.status).toBe(504);
  });

  it('returns the upstream status JSON on success', async () => {
    const fakeStatus = { status: 'done', crash_rebound: [{ ticker: 'NVDA.SW' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(fakeStatus), { status: 200 })));
    const { GET } = await import('../app/api/research/volatility/rebound/status/route');
    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(fakeStatus);
  });
});
