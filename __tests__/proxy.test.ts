import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// withAuth normally wraps the inner middleware and only calls it after its
// own `authorized` callback passes - mocking it to just capture both pieces
// lets this test drive the inner /research check directly, the same way
// withAuth would, without needing a real request/OAuth session.
let capturedMiddleware: ((req: unknown) => unknown) | undefined;
let capturedOptions: { callbacks: { authorized: (args: { token: unknown }) => boolean } } | undefined;

vi.mock('next-auth/middleware', () => ({
  withAuth: vi.fn((middleware: (req: unknown) => unknown, options: typeof capturedOptions) => {
    capturedMiddleware = middleware;
    capturedOptions = options;
    return middleware;
  }),
}));

const OWNER_EMAIL = 'owner@example.com';

vi.mock('@/lib/researchAccess', () => ({
  isResearchAllowed: (email: string | null | undefined) => email === OWNER_EMAIL,
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

  it('lets the research owner through /research/*', async () => {
    await import('../proxy');
    const result = capturedMiddleware!(reqWithEmail('/research/volatility', OWNER_EMAIL));
    expect(result).toBeUndefined();
  });

  it('404s a logged-in non-owner on /research/*', async () => {
    await import('../proxy');
    const result = capturedMiddleware!(reqWithEmail('/research/volatility', 'other@example.com')) as Response;
    expect(result.status).toBe(404);
  });

  it('404s a logged-in non-owner on /api/research/*', async () => {
    await import('../proxy');
    const result = capturedMiddleware!(reqWithEmail('/api/research/volatility/status', 'other@example.com')) as Response;
    expect(result.status).toBe(404);
  });

  it('leaves non-research paths alone for any authenticated user', async () => {
    await import('../proxy');
    const result = capturedMiddleware!(reqWithEmail('/', 'other@example.com'));
    expect(result).toBeUndefined();
  });

  it('still requires a token at all, regardless of path', async () => {
    await import('../proxy');
    expect(capturedOptions!.callbacks.authorized({ token: null })).toBe(false);
    expect(capturedOptions!.callbacks.authorized({ token: { email: OWNER_EMAIL } })).toBe(true);
  });
});
