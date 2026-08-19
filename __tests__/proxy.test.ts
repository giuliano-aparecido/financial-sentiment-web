import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// withAuth normally wraps the inner middleware and only calls it after its
// own `authorized` callback passes - mocking it to just capture both pieces
// lets this test drive the inner path-authorization check directly, the
// same way withAuth would, without needing a real request/OAuth session.
let capturedMiddleware: ((req: unknown) => unknown) | undefined;
let capturedOptions: { callbacks: { authorized: (args: { token: unknown }) => boolean } } | undefined;

vi.mock('next-auth/middleware', () => ({
  withAuth: vi.fn((middleware: (req: unknown) => unknown, options: typeof capturedOptions) => {
    capturedMiddleware = middleware;
    capturedOptions = options;
    return middleware;
  }),
}));

// ALLOWED_EMAILS and ALLOWED_EMAILS_RESEARCH are independent allowlists -
// these two emails each belong to exactly one, so tests can assert the
// isolation both directions (research-only blocked from general pages,
// general-only blocked from /research).
const RESEARCH_EMAIL = 'research-only@example.com';
const GENERAL_EMAIL = 'general-only@example.com';

vi.mock('@/lib/researchAccess', () => ({
  isResearchAllowed: (email: string | null | undefined) => email === RESEARCH_EMAIL,
}));

vi.mock('@/lib/auth', () => ({
  isAllowedEmail: (email: string | null | undefined) => email === GENERAL_EMAIL,
}));

function reqWithEmail(pathname: string, email: string | null) {
  return { nextUrl: { pathname }, nextauth: { token: email ? { email } : null } };
}

describe('proxy', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    capturedMiddleware = undefined;
    capturedOptions = undefined;
    (process.env as { NODE_ENV: string }).NODE_ENV = 'production';
  });

  afterEach(() => {
    (process.env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv as string;
  });

  it('lets a research-allowed email through /research/*', async () => {
    await import('../proxy');
    const result = capturedMiddleware!(reqWithEmail('/research/volatility', RESEARCH_EMAIL));
    expect(result).toBeUndefined();
  });

  it('404s a general-allowed (but not research-allowed) email on /research/*', async () => {
    await import('../proxy');
    const result = capturedMiddleware!(reqWithEmail('/research/volatility', GENERAL_EMAIL)) as Response;
    expect(result.status).toBe(404);
  });

  it('404s a general-allowed (but not research-allowed) email on /api/research/*', async () => {
    await import('../proxy');
    const result = capturedMiddleware!(reqWithEmail('/api/research/volatility/status', GENERAL_EMAIL)) as Response;
    expect(result.status).toBe(404);
  });

  it('lets a general-allowed email through non-research paths', async () => {
    await import('../proxy');
    const result = capturedMiddleware!(reqWithEmail('/', GENERAL_EMAIL));
    expect(result).toBeUndefined();
  });

  it('404s a research-allowed (but not general-allowed) email on non-research paths', async () => {
    await import('../proxy');
    const result = capturedMiddleware!(reqWithEmail('/', RESEARCH_EMAIL)) as Response;
    expect(result.status).toBe(404);
  });

  it('still requires a token at all, regardless of path', async () => {
    await import('../proxy');
    expect(capturedOptions!.callbacks.authorized({ token: null })).toBe(false);
    expect(capturedOptions!.callbacks.authorized({ token: { email: GENERAL_EMAIL } })).toBe(true);
  });
});
