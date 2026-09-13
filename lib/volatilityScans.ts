import { useEffect, useMemo, useRef, useState } from 'react';
import { runBackendAwareFetch, runBackendAwareMutation } from '@/lib/backendAwareFetch';

export interface CrashReboundRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: number | null;
  avg_volume_10d: number | null;
  loss_date: string;
  loss_close: number | null;
  drop_pct: number | null;
  days_to_rebound: number;
  gain_date: string;
  gain_close: number | null;
  gain_pct: number | null;
}

export interface TodayScreenerRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: number | null;
  price: number | null;
  change_pct: number | null;
  volume_today: number | null;
  avg_volume_10d: number | null;
}

export interface VolatilityIndicatorRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: number | null;
  loss_days: number;
  gain_days: number;
  total_days: number;
}

export interface ReboundScanResult {
  rows: CrashReboundRow[];
  scan_run_at: string | null;
  is_running: boolean;
  failed_ticker_count: number;
}

export interface IndicatorScanResult {
  rows: VolatilityIndicatorRow[];
  scan_run_at: string | null;
  is_running: boolean;
  failed_ticker_count: number;
}

export interface TodayScanStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  started_at?: string;
  finished_at?: string;
  universe_size?: number;
  today_screener?: TodayScreenerRow[];
  error?: string;
}

export const THRESHOLD_OPTIONS = [2, 3, 5] as const;

const POLL_INTERVAL_MS = 5000;

// 24 * 5s = ~2min budget before giving up and showing a real error -
// comfortably above the research backend's own cold-start window (Render
// free tier, up to ~1min; see app/research/volatility/page.tsx's
// BackendStartingNotice).
const BACKEND_STARTUP_MAX_ATTEMPTS = 24;

const UNIVERSE_LABEL = 'chf500m-plus-ex-smi';
const todayIso = () => new Date().toISOString().slice(0, 10);

export interface CsvColumn<T> {
  key: Extract<keyof T, string>;
  label: string;
}

const CRASH_REBOUND_CSV_COLUMNS: CsvColumn<CrashReboundRow>[] = [
  { key: 'ticker', label: 'Ticker' },
  { key: 'name', label: 'Name' },
  { key: 'sector', label: 'Sector' },
  { key: 'market_cap', label: 'Market cap' },
  { key: 'avg_volume_10d', label: 'ADTV (10d)' },
  { key: 'loss_date', label: 'Loss date' },
  { key: 'loss_close', label: 'Loss close' },
  { key: 'drop_pct', label: 'Drop %' },
  { key: 'days_to_rebound', label: 'Days to rebound' },
  { key: 'gain_date', label: 'Gain date' },
  { key: 'gain_close', label: 'Gain close' },
  { key: 'gain_pct', label: 'Gain %' },
];

const TODAY_SCREENER_CSV_COLUMNS: CsvColumn<TodayScreenerRow>[] = [
  { key: 'ticker', label: 'Ticker' },
  { key: 'name', label: 'Name' },
  { key: 'sector', label: 'Sector' },
  { key: 'market_cap', label: 'Market cap' },
  { key: 'price', label: 'Price' },
  { key: 'change_pct', label: 'Change %' },
  { key: 'volume_today', label: 'Volume today' },
];

const VOLATILITY_INDICATOR_CSV_COLUMNS: CsvColumn<VolatilityIndicatorRow>[] = [
  { key: 'ticker', label: 'Ticker' },
  { key: 'name', label: 'Name' },
  { key: 'sector', label: 'Sector' },
  { key: 'market_cap', label: 'Market cap' },
  { key: 'loss_days', label: 'Loss days' },
  { key: 'gain_days', label: 'Gain days' },
  { key: 'total_days', label: 'Total days' },
];

function escapeCsvValue(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function rowsToCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

function downloadCsv(filename: string, csvContent: string): void {
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export type SortDirection = 'asc' | 'desc';
export type SortState = { key: string | null; direction: SortDirection };

export function sortRows<T extends object>(rows: T[], sort: SortState): T[] {
  if (!sort.key) return rows;
  const key = sort.key;
  const dir = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' && typeof bv === 'string') {
      return dir * av.localeCompare(bv);
    }
    return dir * (Number(av) - Number(bv));
  });
}

export function toggleSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, direction: 'asc' };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

function confirmScanStart(lastRunIso: string | null, warning: string): boolean {
  const lastRunText = lastRunIso
    ? `The last scan ran at ${new Date(lastRunIso).toLocaleString()}.`
    : 'No scan has run yet.';
  return window.confirm(`${lastRunText}\n\n${warning} Continue?`);
}

function downloadScanCsv<T>(rows: T[], columns: CsvColumn<T>[], filename: string): void {
  downloadCsv(filename, rowsToCsv(rows, columns));
}

async function triggerScanMutation({
  url,
  stopPolling,
  fetchLatest,
  setTriggerDropped,
  setError,
}: {
  url: string;
  stopPolling: () => void;
  fetchLatest: () => void;
  setTriggerDropped: (dropped: boolean) => void;
  setError: (error: string) => void;
}): Promise<void> {
  setError('');
  setTriggerDropped(false);
  const outcome = await runBackendAwareMutation({ url, stopPolling, fetchLatest, setTriggerDropped, setError });
  if (!outcome.ok) return;
  stopPolling();
  fetchLatest();
}

function usePollController() {
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    abortController.current?.abort();
  };

  return { pollTimer, abortController, stopPolling };
}

export function useReboundScan() {
  const [result, setResult] = useState<ReboundScanResult>({ rows: [], scan_run_at: null, is_running: false, failed_ticker_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backendStarting, setBackendStarting] = useState(false);
  const [triggerDropped, setTriggerDropped] = useState(false);
  const { pollTimer, abortController, stopPolling } = usePollController();
  const [sort, setSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedRows = useMemo(() => sortRows(result.rows, sort), [result.rows, sort]);

  const fetchResult = async (attempt = 0): Promise<void> => {
    try {
      await runBackendAwareFetch({
        url: '/api/research/volatility/rebound',
        attempt,
        timerRef: pollTimer,
        abortControllerRef: abortController,
        setBackendStarting,
        setTriggerDropped,
        setError,
        stopPolling,
        networkErrorMessage: 'Failed to reach the research backend.',
        retry: fetchResult,
        pollIntervalMs: POLL_INTERVAL_MS,
        maxAttempts: BACKEND_STARTUP_MAX_ATTEMPTS,
        onSuccess: (data) => {
          const parsed = data as ReboundScanResult;
          setResult(parsed);
          if (parsed.is_running) {
            pollTimer.current = setTimeout(() => fetchResult(), POLL_INTERVAL_MS);
          } else {
            stopPolling();
          }
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!confirmScanStart(result.scan_run_at, 'Running a new scan makes live Yahoo Finance calls and can take several minutes.')) return;
    await triggerScanMutation({
      url: '/api/research/volatility/rebound/start',
      stopPolling,
      fetchLatest: fetchResult,
      setTriggerDropped,
      setError,
    });
  };

  const handleRetry = async () => {
    await triggerScanMutation({
      url: '/api/research/volatility/rebound/retryOnlyFailed',
      stopPolling,
      fetchLatest: fetchResult,
      setTriggerDropped,
      setError,
    });
  };

  const handleDownload = () => {
    downloadScanCsv(sortedRows, CRASH_REBOUND_CSV_COLUMNS, `swiss-${UNIVERSE_LABEL}-crash-rebound-${todayIso()}.csv`);
  };

  useEffect(() => {
    fetchResult();
    return stopPolling;
    // Intentionally mount-once: fetchResult is recreated every render (it
    // closes over state setters), so listing it would re-run this effect
    // on every render instead of once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { result, loading, error, backendStarting, triggerDropped, sort, setSort, sortedRows, handleRefresh, handleRetry, handleDownload };
}

export function useTodayScan() {
  const [status, setStatus] = useState<TodayScanStatus>({ status: 'idle' });
  const [error, setError] = useState('');
  const [backendStarting, setBackendStarting] = useState(false);
  const [triggerDropped, setTriggerDropped] = useState(false);
  const { pollTimer, abortController, stopPolling } = usePollController();
  const [sort, setSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedRows = useMemo(() => sortRows(status.today_screener ?? [], sort), [status.today_screener, sort]);
  const isRunning = status.status === 'running';

  const pollStatus = async (attempt = 0): Promise<void> => {
    await runBackendAwareFetch({
      url: '/api/research/volatility/today/status',
      attempt,
      timerRef: pollTimer,
      abortControllerRef: abortController,
      setBackendStarting,
      setTriggerDropped,
      setError,
      stopPolling,
      networkErrorMessage: 'Lost connection while checking scan status.',
      retry: pollStatus,
      pollIntervalMs: POLL_INTERVAL_MS,
      maxAttempts: BACKEND_STARTUP_MAX_ATTEMPTS,
      onSuccess: (data) => {
        const parsed = data as TodayScanStatus;
        setStatus(parsed);
        if (parsed.status === 'running') {
          pollTimer.current = setTimeout(() => pollStatus(), POLL_INTERVAL_MS);
        }
      },
    });
  };

  const handleRefresh = async () => {
    await triggerScanMutation({
      url: '/api/research/volatility/today/start',
      stopPolling,
      fetchLatest: pollStatus,
      setTriggerDropped,
      setError,
    });
  };

  const handleDownload = () => {
    downloadScanCsv(sortedRows, TODAY_SCREENER_CSV_COLUMNS, `swiss-${UNIVERSE_LABEL}-today-${todayIso()}.csv`);
  };

  useEffect(() => {
    pollStatus();
    return stopPolling;
    // Intentionally mount-once: pollStatus is recreated every render (it
    // closes over state setters), so listing it would re-run this effect
    // on every render instead of once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, error, backendStarting, triggerDropped, isRunning, sort, setSort, sortedRows, handleRefresh, handleDownload };
}

export function useIndicatorScan() {
  const [result, setResult] = useState<IndicatorScanResult>({ rows: [], scan_run_at: null, is_running: false, failed_ticker_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backendStarting, setBackendStarting] = useState(false);
  const [triggerDropped, setTriggerDropped] = useState(false);
  const [threshold, setThreshold] = useState<number>(THRESHOLD_OPTIONS[0]);
  const { pollTimer, abortController, stopPolling } = usePollController();
  const [sort, setSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedRows = useMemo(() => sortRows(result.rows, sort), [result.rows, sort]);

  const fetchResult = async (thresholdPct: number, attempt = 0): Promise<void> => {
    try {
      await runBackendAwareFetch({
        url: `/api/research/volatility/indicator?threshold_pct=${thresholdPct}`,
        attempt,
        timerRef: pollTimer,
        abortControllerRef: abortController,
        setBackendStarting,
        setTriggerDropped,
        setError,
        stopPolling,
        networkErrorMessage: 'Failed to reach the research backend.',
        retry: (next) => fetchResult(thresholdPct, next),
        pollIntervalMs: POLL_INTERVAL_MS,
        maxAttempts: BACKEND_STARTUP_MAX_ATTEMPTS,
        onSuccess: (data) => {
          const parsed = data as IndicatorScanResult;
          setResult(parsed);
          if (parsed.is_running) {
            pollTimer.current = setTimeout(() => fetchResult(thresholdPct), POLL_INTERVAL_MS);
          } else {
            stopPolling();
          }
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (
      !confirmScanStart(
        result.scan_run_at,
        'Running a new scan covers all three thresholds, makes live Yahoo Finance calls, and can take several minutes.',
      )
    ) {
      return;
    }
    await triggerScanMutation({
      url: `/api/research/volatility/indicator/start?threshold_pct=${threshold}`,
      stopPolling,
      fetchLatest: () => fetchResult(threshold),
      setTriggerDropped,
      setError,
    });
  };

  const handleRetry = async () => {
    await triggerScanMutation({
      url: '/api/research/volatility/indicator/retryOnlyFailed',
      stopPolling,
      fetchLatest: () => fetchResult(threshold),
      setTriggerDropped,
      setError,
    });
  };

  const handleDownload = () => {
    downloadScanCsv(sortedRows, VOLATILITY_INDICATOR_CSV_COLUMNS, `swiss-${UNIVERSE_LABEL}-volatility-indicator-${threshold}pct-${todayIso()}.csv`);
  };

  useEffect(() => {
    stopPolling();
    fetchResult(threshold);
    return stopPolling;
    // Intentionally re-runs only on threshold change: fetchResult is
    // recreated every render (it closes over state setters), so listing it
    // would re-run this effect on every render instead of only when the
    // threshold actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  return { result, loading, error, backendStarting, triggerDropped, threshold, setThreshold, sort, setSort, sortedRows, handleRefresh, handleRetry, handleDownload };
}
