import type { MutableRefObject } from 'react';

export function isBackendUnavailableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

interface ScheduleBackendRetryOptions {
  timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setBackendStarting: (starting: boolean) => void;
  attempt: number;
  retry: (nextAttempt: number) => void;
  pollIntervalMs: number;
  maxAttempts: number;
}

export function scheduleBackendRetry({
  timerRef,
  setBackendStarting,
  attempt,
  retry,
  pollIntervalMs,
  maxAttempts,
}: ScheduleBackendRetryOptions): boolean {
  if (attempt >= maxAttempts) return false;
  setBackendStarting(true);
  timerRef.current = setTimeout(() => retry(attempt + 1), pollIntervalMs);
  return true;
}

interface FallBackToPassiveRefreshOptions {
  stopPolling: () => void;
  fetchLatest: () => void;
  setTriggerDropped: (dropped: boolean) => void;
}

export function fallBackToPassiveRefresh({
  stopPolling,
  fetchLatest,
  setTriggerDropped,
}: FallBackToPassiveRefreshOptions): void {
  setTriggerDropped(true);
  stopPolling();
  fetchLatest();
}

interface RunBackendAwareFetchOptions {
  url: string;
  attempt: number;
  timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  setBackendStarting: (starting: boolean) => void;
  setTriggerDropped: (dropped: boolean) => void;
  setError: (error: string) => void;
  stopPolling: () => void;
  networkErrorMessage: string;
  retry: (nextAttempt: number) => void;
  onSuccess: (data: unknown) => void;
  pollIntervalMs: number;
  maxAttempts: number;
}

// abortControllerRef makes each call supersede whatever it started: a
// newer fetch for the same ref (e.g. switching the indicator threshold,
// or double-clicking Refresh) aborts the previous one's actual network
// request and, via the `abortControllerRef.current !== controller` checks
// below, ignores that request's response even if it had already landed -
// otherwise a stale response for an old selection could resolve after a
// fresher one and silently overwrite it, and both would fight over the
// same timerRef for any further polling.
export async function runBackendAwareFetch({
  url,
  attempt,
  timerRef,
  abortControllerRef,
  setBackendStarting,
  setTriggerDropped,
  setError,
  stopPolling,
  networkErrorMessage,
  retry,
  onSuccess,
  pollIntervalMs,
  maxAttempts,
}: RunBackendAwareFetchOptions): Promise<void> {
  abortControllerRef.current?.abort();
  const controller = new AbortController();
  abortControllerRef.current = controller;

  setError('');
  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (abortControllerRef.current !== controller) return;
    if (!response.ok) {
      const retrying = isBackendUnavailableStatus(response.status) && scheduleBackendRetry({
        timerRef,
        setBackendStarting,
        attempt,
        retry,
        pollIntervalMs,
        maxAttempts,
      });
      if (retrying) {
        return;
      }
      setBackendStarting(false);
      setTriggerDropped(false);
      setError((data as { error?: string } | null)?.error || `Server returned status ${response.status}`);
      stopPolling();
      return;
    }
    setBackendStarting(false);
    setTriggerDropped(false);
    onSuccess(data);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    if (abortControllerRef.current !== controller) return;
    const retrying = scheduleBackendRetry({ timerRef, setBackendStarting, attempt, retry, pollIntervalMs, maxAttempts });
    if (retrying) {
      return;
    }
    setBackendStarting(false);
    setTriggerDropped(false);
    setError(networkErrorMessage);
    stopPolling();
  }
}

interface RunBackendAwareMutationOptions {
  url: string;
  stopPolling: () => void;
  fetchLatest: () => void;
  setTriggerDropped: (dropped: boolean) => void;
  setError: (error: string) => void;
}

type BackendAwareMutationResult = { ok: true; data: unknown } | { ok: false };

export async function runBackendAwareMutation({
  url,
  stopPolling,
  fetchLatest,
  setTriggerDropped,
  setError,
}: RunBackendAwareMutationOptions): Promise<BackendAwareMutationResult> {
  try {
    const response = await fetch(url, { method: 'POST' });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (isBackendUnavailableStatus(response.status)) {
        fallBackToPassiveRefresh({ stopPolling, fetchLatest, setTriggerDropped });
        return { ok: false };
      }
      setError((data as { error?: string } | null)?.error || `Server returned status ${response.status}`);
      return { ok: false };
    }
    return { ok: true, data };
  } catch {
    fallBackToPassiveRefresh({ stopPolling, fetchLatest, setTriggerDropped });
    return { ok: false };
  }
}
