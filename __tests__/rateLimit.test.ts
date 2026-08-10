import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit } from '@/lib/rateLimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('allows up to the default 10 requests per 60s for the same key', () => {
    const key = `test-default-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(key)).toBe(true);
    }
    expect(checkRateLimit(key)).toBe(false);
  });

  it('respects a custom window/max independently of the default budget', () => {
    const key = `test-custom-${Math.random()}`;
    expect(checkRateLimit(key, 5 * 60_000, 1)).toBe(true);
    expect(checkRateLimit(key, 5 * 60_000, 1)).toBe(false);
  });

  it('different keys get independent buckets, even with the same base identity', () => {
    const base = `test-namespace-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(`analyze:${base}`)).toBe(true);
    }
    // A different prefix (e.g. "research:") on the same underlying user
    // must not be exhausted by the other route's usage.
    expect(checkRateLimit(`research:${base}`, 5 * 60_000, 1)).toBe(true);
  });
});
