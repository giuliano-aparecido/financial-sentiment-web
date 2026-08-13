import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));

import { signOut } from 'next-auth/react';
import { signOutToLogin } from '../lib/signOutToLogin';

const signOutMock = vi.mocked(signOut);

// Regression test for a production incident: signOutToLogin used to
// encodeURIComponent(pathname) itself AND hand that to URLSearchParams,
// which encodes its values again on toString() - double-encoding the
// path. /login's searchParams.get('callbackUrl') only undoes one layer,
// so it came back still percent-escaped (e.g. "%2Fresearch%2F...")
// instead of a real path, and NextAuth's redirect callback then threw
// "TypeError: Invalid URL" trying to use it. Asserting the callbackUrl a
// real URL parser recovers - not just the raw string - is what would have
// caught that.
function extractCallbackUrl(loginUrl: string): string | null {
  return new URL(loginUrl, 'https://example.com').searchParams.get('callbackUrl');
}

describe('signOutToLogin', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    signOutMock.mockClear();
    // @ts-expect-error - minimal stub, only .location.pathname is used
    globalThis.window = { location: { pathname: '/research/volatility' } };
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it('round-trips a nested path through the login URL intact', () => {
    signOutToLogin();
    const { callbackUrl } = signOutMock.mock.calls[0][0] as { callbackUrl: string };
    expect(extractCallbackUrl(callbackUrl)).toBe('/research/volatility');
  });

  it('carries an error param alongside the callbackUrl', () => {
    signOutToLogin({ error: 'SessionExpired' });
    const { callbackUrl } = signOutMock.mock.calls[0][0] as { callbackUrl: string };
    const url = new URL(callbackUrl, 'https://example.com');
    expect(url.searchParams.get('error')).toBe('SessionExpired');
    expect(extractCallbackUrl(callbackUrl)).toBe('/research/volatility');
  });
});
