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

// The POST itself is abandoned rather than retried - no idempotency
// machinery to safely retry a state-mutating request against a gateway
// that may have received-but-not-acked it.
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

export async function runBackendAwareFetch({
  url,
  attempt,
  timerRef,
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
  setError('');
  try {
    const response = await fetch(url);
    const data = await response.json().catch(() => null);
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
  } catch {
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
