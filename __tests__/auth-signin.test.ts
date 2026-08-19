import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ALLOWED_EMAILS and ALLOWED_EMAILS_RESEARCH are independent allowlists -
// signIn must accept membership in either one, not require ALLOWED_EMAILS
// specifically (see lib/auth.ts's signIn callback and proxy.ts/api/analyze's
// own path-specific enforcement of which pages a research-only session can
// actually reach).
vi.mock('@/lib/researchAccess', () => ({
  isResearchAllowed: (email: string | null | undefined) => email === 'research-only@example.com',
}));

describe('authOptions.callbacks.signIn', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    (process.env as { NODE_ENV: string }).NODE_ENV = 'production';
    process.env.NEXTAUTH_SECRET = 'test-secret';
    process.env.ALLOWED_EMAILS = 'general-only@example.com';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows sign-in for an ALLOWED_EMAILS-only email', async () => {
    const { authOptions } = await import('../lib/auth');
    const result = await authOptions.callbacks!.signIn!({ user: { email: 'general-only@example.com' } } as never);
    expect(result).toBe(true);
  });

  it('allows sign-in for an ALLOWED_EMAILS_RESEARCH-only email', async () => {
    const { authOptions } = await import('../lib/auth');
    const result = await authOptions.callbacks!.signIn!({ user: { email: 'research-only@example.com' } } as never);
    expect(result).toBe(true);
  });

  it('denies sign-in for an email in neither list', async () => {
    const { authOptions } = await import('../lib/auth');
    const result = await authOptions.callbacks!.signIn!({ user: { email: 'nobody@example.com' } } as never);
    expect(result).toBe(false);
  });

  it('denies sign-in when the email is missing entirely', async () => {
    const { authOptions } = await import('../lib/auth');
    const result = await authOptions.callbacks!.signIn!({ user: {} } as never);
    expect(result).toBe(false);
  });
});
