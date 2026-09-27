import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('authOptions.callbacks.signIn', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    (process.env as { NODE_ENV: string }).NODE_ENV = 'production';
    process.env.NEXTAUTH_SECRET = 'test-secret';
    process.env.ALLOWED_EMAILS = 'allowed@example.com';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows sign-in for an ALLOWED_EMAILS email', async () => {
    const { authOptions } = await import('../lib/auth');
    const result = await authOptions.callbacks!.signIn!({ user: { email: 'allowed@example.com' } } as never);
    expect(result).toBe(true);
  });

  it('denies sign-in for an email not in the list', async () => {
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
