import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let capturedOptions: { callbacks: { authorized: (args: { token: unknown }) => boolean } } | undefined;

vi.mock('next-auth/middleware', () => ({
  withAuth: vi.fn((options: typeof capturedOptions) => {
    capturedOptions = options;
    return () => undefined;
  }),
}));

describe('proxy', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    capturedOptions = undefined;
    (process.env as { NODE_ENV: string }).NODE_ENV = 'production';
  });

  afterEach(() => {
    (process.env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv as string;
  });

  it('requires a token, and nothing more - isAllowedEmail is already enforced at sign-in', async () => {
    await import('../proxy');
    expect(capturedOptions!.callbacks.authorized({ token: null })).toBe(false);
    expect(capturedOptions!.callbacks.authorized({ token: { email: 'anyone@example.com' } })).toBe(true);
  });
});
