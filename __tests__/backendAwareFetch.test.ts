import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isBackendUnavailableStatus,
  scheduleBackendRetry,
  fallBackToPassiveRefresh,
  runBackendAwareFetch,
  runBackendAwareMutation,
} from '@/lib/backendAwareFetch';

describe('isBackendUnavailableStatus', () => {
  it('treats 502/503/504 as backend-unavailable', () => {
    expect(isBackendUnavailableStatus(502)).toBe(true);
    expect(isBackendUnavailableStatus(503)).toBe(true);
    expect(isBackendUnavailableStatus(504)).toBe(true);
  });

  it('treats other statuses as not backend-unavailable', () => {
    expect(isBackendUnavailableStatus(200)).toBe(false);
    expect(isBackendUnavailableStatus(400)).toBe(false);
    expect(isBackendUnavailableStatus(429)).toBe(false);
    expect(isBackendUnavailableStatus(500)).toBe(false);
    expect(isBackendUnavailableStatus(501)).toBe(false);
  });
});

describe('scheduleBackendRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a retry and returns true when under the attempt budget', () => {
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
    const setBackendStarting = vi.fn();
    const retry = vi.fn();

    const scheduled = scheduleBackendRetry({
      timerRef,
      setBackendStarting,
      attempt: 3,
      retry,
      pollIntervalMs: 5000,
      maxAttempts: 24,
    });

    expect(scheduled).toBe(true);
    expect(setBackendStarting).toHaveBeenCalledWith(true);
    expect(retry).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(retry).toHaveBeenCalledWith(4);
  });

  it('declines to retry once the attempt budget is exhausted', () => {
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
    const setBackendStarting = vi.fn();
    const retry = vi.fn();

    const scheduled = scheduleBackendRetry({
      timerRef,
      setBackendStarting,
      attempt: 24,
      retry,
      pollIntervalMs: 5000,
      maxAttempts: 24,
    });

    expect(scheduled).toBe(false);
    expect(setBackendStarting).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('fallBackToPassiveRefresh', () => {
  it('flags the dropped trigger before stopping polling and re-fetching', () => {
    const calls: string[] = [];
    const setTriggerDropped = vi.fn(() => calls.push('setTriggerDropped'));
    const stopPolling = vi.fn(() => calls.push('stopPolling'));
    const fetchLatest = vi.fn(() => calls.push('fetchLatest'));

    fallBackToPassiveRefresh({ stopPolling, fetchLatest, setTriggerDropped });

    expect(setTriggerDropped).toHaveBeenCalledWith(true);
    expect(calls).toEqual(['setTriggerDropped', 'stopPolling', 'fetchLatest']);
  });
});

describe('runBackendAwareFetch', () => {
  function makeDeps() {
    return {
      timerRef: { current: null as ReturnType<typeof setTimeout> | null },
      setBackendStarting: vi.fn(),
      setTriggerDropped: vi.fn(),
      setError: vi.fn(),
      stopPolling: vi.fn(),
      retry: vi.fn(),
      onSuccess: vi.fn(),
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('on success, clears error, resets state, and hands the parsed body to onSuccess', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const deps = makeDeps();

    await runBackendAwareFetch({
      url: '/api/x',
      attempt: 0,
      ...deps,
      networkErrorMessage: 'unreachable',
      pollIntervalMs: 5000,
      maxAttempts: 24,
    });

    expect(deps.setError).toHaveBeenCalledWith('');
    expect(deps.setBackendStarting).toHaveBeenCalledWith(false);
    expect(deps.setTriggerDropped).toHaveBeenCalledWith(false);
    expect(deps.onSuccess).toHaveBeenCalledWith({ ok: true });
    expect(deps.stopPolling).not.toHaveBeenCalled();
  });

  it('on a non-retryable error status, sets the server error message and stops polling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })),
    );
    const deps = makeDeps();

    await runBackendAwareFetch({
      url: '/api/x',
      attempt: 0,
      ...deps,
      networkErrorMessage: 'unreachable',
      pollIntervalMs: 5000,
      maxAttempts: 24,
    });

    expect(deps.setError).toHaveBeenCalledWith('bad request');
    expect(deps.stopPolling).toHaveBeenCalled();
    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it('on a backend-unavailable status under the attempt budget, schedules a retry instead of erroring', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(null), { status: 502 })));
    const deps = makeDeps();

    await runBackendAwareFetch({
      url: '/api/x',
      attempt: 0,
      ...deps,
      networkErrorMessage: 'unreachable',
      pollIntervalMs: 5000,
      maxAttempts: 24,
    });

    expect(deps.setBackendStarting).toHaveBeenCalledWith(true);
    expect(deps.stopPolling).not.toHaveBeenCalled();
    // Only the initial `setError('')` clear - no failure message set while retrying.
    expect(deps.setError).toHaveBeenCalledTimes(1);
    expect(deps.setError).toHaveBeenCalledWith('');
  });

  it('on a backend-unavailable status once attempts are exhausted, errors and stops polling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(null), { status: 503 })));
    const deps = makeDeps();

    await runBackendAwareFetch({
      url: '/api/x',
      attempt: 24,
      ...deps,
      networkErrorMessage: 'unreachable',
      pollIntervalMs: 5000,
      maxAttempts: 24,
    });

    expect(deps.setError).toHaveBeenCalledWith('Server returned status 503');
    expect(deps.stopPolling).toHaveBeenCalled();
  });

  it('on a network failure under the attempt budget, schedules a retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const deps = makeDeps();

    await runBackendAwareFetch({
      url: '/api/x',
      attempt: 0,
      ...deps,
      networkErrorMessage: 'unreachable',
      pollIntervalMs: 5000,
      maxAttempts: 24,
    });

    expect(deps.setBackendStarting).toHaveBeenCalledWith(true);
    expect(deps.stopPolling).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledTimes(1);
  });

  it('on a network failure once attempts are exhausted, sets the network error message and stops polling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const deps = makeDeps();

    await runBackendAwareFetch({
      url: '/api/x',
      attempt: 24,
      ...deps,
      networkErrorMessage: 'unreachable',
      pollIntervalMs: 5000,
      maxAttempts: 24,
    });

    expect(deps.setError).toHaveBeenCalledWith('unreachable');
    expect(deps.stopPolling).toHaveBeenCalled();
  });
});

describe('runBackendAwareMutation', () => {
  function makeDeps() {
    return {
      stopPolling: vi.fn(),
      fetchLatest: vi.fn(),
      setTriggerDropped: vi.fn(),
      setError: vi.fn(),
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('on success, returns the parsed body without touching error/fallback state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ started: true }), { status: 200 })));
    const deps = makeDeps();

    const result = await runBackendAwareMutation({ url: '/api/x', ...deps });

    expect(result).toEqual({ ok: true, data: { started: true } });
    expect(deps.setError).not.toHaveBeenCalled();
    expect(deps.setTriggerDropped).not.toHaveBeenCalled();
    expect(deps.stopPolling).not.toHaveBeenCalled();
    expect(deps.fetchLatest).not.toHaveBeenCalled();
  });

  it('on a non-retryable error status, sets the server error message and does not fall back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })),
    );
    const deps = makeDeps();

    const result = await runBackendAwareMutation({ url: '/api/x', ...deps });

    expect(result).toEqual({ ok: false });
    expect(deps.setError).toHaveBeenCalledWith('bad request');
    expect(deps.fetchLatest).not.toHaveBeenCalled();
    expect(deps.setTriggerDropped).not.toHaveBeenCalled();
  });

  it('on a backend-unavailable status, falls back to the passive refresh instead of erroring', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(null), { status: 503 })));
    const deps = makeDeps();

    const result = await runBackendAwareMutation({ url: '/api/x', ...deps });

    expect(result).toEqual({ ok: false });
    expect(deps.setError).not.toHaveBeenCalled();
    expect(deps.setTriggerDropped).toHaveBeenCalledWith(true);
    expect(deps.stopPolling).toHaveBeenCalled();
    expect(deps.fetchLatest).toHaveBeenCalled();
  });

  it('on a network failure, falls back to the passive refresh instead of erroring', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const deps = makeDeps();

    const result = await runBackendAwareMutation({ url: '/api/x', ...deps });

    expect(result).toEqual({ ok: false });
    expect(deps.setError).not.toHaveBeenCalled();
    expect(deps.setTriggerDropped).toHaveBeenCalledWith(true);
    expect(deps.stopPolling).toHaveBeenCalled();
    expect(deps.fetchLatest).toHaveBeenCalled();
  });
});
