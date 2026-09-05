import { useEffect, useMemo, useRef, useState } from 'react';
import { runBackendAwareFetch, runBackendAwareMutation } from '@/lib/backendAwareFetch';

export interface CrashReboundRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: number | null;
  avg_volume_10d: number | null;
  loss_date: string;
  // Nullable, not just typed as such for form's sake: confirmed live in
  // production - a recently-listed company's own trading history can
  // start INSIDE the lookback window, giving its first day a NaN %
  // change (serialized as JSON null - see financial-sentiment-api's
  // research_job.py's _json_safe_records) that crashed this page's
  // raw row.drop_pct.toFixed(2) call. Backend now excludes that row
  // entirely (see swiss_crash_rebound.py), but these stay nullable here
  // too - never assume an external API's numeric field can't be null at
  // runtime just because a fix landed once.
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

// Rebound and volatility-indicator are no longer scanned live on every
// click (2026-08-19) - financial-sentiment-api's scheduler.py now runs
// each on a schedule (daily / monthly) and persists the result, at the
// user's explicit request to cut Yahoo Finance call volume. A manual
// Refresh button still exists for both (2026-08-19, also explicit
// request) - it triggers the SAME guarded pipeline the cron uses, so
// is_running here is true whether the in-progress scan was started
// automatically or by this button, and the frontend can't tell (or need
// to) which. "Today" (big-loss) is unchanged: fully live/on-demand via
// its own separate job-slot status, since intraday data has no
// meaningful cache window - see TodayScanStatus below.
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

// Polling this often keeps the wait feeling responsive without coming
// close to the status routes' own 30-per-60s budget (see
// app/api/research/volatility/*/status/route.ts) - a 1-3 minute scan
// polled every 5s is at most ~36 requests total, spread out, not bursty.
const POLL_INTERVAL_MS = 5000;

// How many consecutive backend-unavailable responses to silently retry
// through (at POLL_INTERVAL_MS apart) before giving up and showing a real
// error - see BackendStartingNotice's own comment for why this exists.
// 24 * 5s = 2 minutes, comfortably past a Render free-tier cold start.
const BACKEND_STARTUP_MAX_ATTEMPTS = 24;

const UNIVERSE_LABEL = 'chf500m-plus-ex-smi';
const todayIso = () => new Date().toISOString().slice(0, 10);

export interface CsvColumn<T> {
  key: Extract<keyof T, string>;
  label: string;
}

// Column lists for CSV export, kept separate from the <table> JSX in
// page.tsx rather than driving both from one shared definition - the
// table cells have per-column formatting/coloring (CHF prefixes, +/-
// signs, red/green) that isn't worth generalizing into a render-prop
// just for this. That means these lists need to be kept in sync BY HAND
// with the <thead> columns there if either changes - these columns have
// already changed five times over this page's life, so don't forget
// this list when they change again.
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

// Exports RAW values (e.g. market_cap as a plain number, not the
// "CHF 1.19B" the table displays) rather than mirroring the on-screen
// formatting - a CSV is meant for further analysis in a spreadsheet,
// where "1190000000" is usable and "CHF 1.19B" just has to be re-parsed.
function rowsToCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

function downloadCsv(filename: string, csvContent: string): void {
  // Leading BOM so Excel (which otherwise guesses the wrong encoding for
  // non-ASCII characters - e.g. accented company names) opens this
  // correctly instead of mangling them.
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

// Generic over the row shape so all three tables (different columns)
// share one implementation. Nulls always sort last regardless of
// direction - "no data" isn't meaningfully "low" or "high", and burying
// it at the bottom either way is less surprising than it jumping to the
// top on a descending sort.
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

// Fetches the current result and, if a scan is running (started by the
// cron OR by handleRefresh below - indistinguishable and that's the
// point, see ReboundScanResult's own comment), keeps polling every 5s
// until it isn't. Called on mount AND right after a manual trigger, so
// both paths converge on the same loop. `attempt` only counts consecutive
// backend-unavailable responses (see BackendStartingNotice) - a healthy
// response resets it, so a long-running is_running poll never trips it.
export function useReboundScan() {
  const [result, setResult] = useState<ReboundScanResult>({ rows: [], scan_run_at: null, is_running: false, failed_ticker_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backendStarting, setBackendStarting] = useState(false);
  const [triggerDropped, setTriggerDropped] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const [sort, setSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedRows = useMemo(() => sortRows(result.rows, sort), [result.rows, sort]);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    abortController.current?.abort();
  };

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
    const lastRunText = result.scan_run_at
      ? `The last scan ran at ${new Date(result.scan_run_at).toLocaleString()}.`
      : 'No scan has run yet.';
    const confirmed = window.confirm(
      `${lastRunText}\n\nRunning a new scan makes live Yahoo Finance calls and can take several minutes. Continue?`,
    );
    if (!confirmed) return;

    setError('');
    setTriggerDropped(false);
    const outcome = await runBackendAwareMutation({
      url: '/api/research/volatility/rebound/start',
      stopPolling,
      fetchLatest: fetchResult,
      setTriggerDropped,
      setError,
    });
    if (!outcome.ok) return;
    stopPolling();
    fetchResult();
  };

  // Separate from handleRefresh above - Refresh is always a hard, full
  // scan (see ReboundScanResult's own comment); this retries ONLY the
  // tickers that failed on the last scan. No confirm() dialog - it's a
  // small, fast operation (a handful of tickers, not the whole universe),
  // unlike a full scan.
  const handleRetry = async () => {
    setError('');
    setTriggerDropped(false);
    const outcome = await runBackendAwareMutation({
      url: '/api/research/volatility/rebound/retry',
      stopPolling,
      fetchLatest: fetchResult,
      setTriggerDropped,
      setError,
    });
    if (!outcome.ok) return;
    stopPolling();
    fetchResult();
  };

  const handleDownload = () => {
    const csv = rowsToCsv(sortedRows, CRASH_REBOUND_CSV_COLUMNS);
    downloadCsv(`swiss-${UNIVERSE_LABEL}-crash-rebound-${todayIso()}.csv`, csv);
  };

  useEffect(() => {
    fetchResult();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { result, loading, error, backendStarting, triggerDropped, sort, setSort, sortedRows, handleRefresh, handleRetry, handleDownload };
}

export function useTodayScan() {
  const [status, setStatus] = useState<TodayScanStatus>({ status: 'idle' });
  const [error, setError] = useState('');
  const [backendStarting, setBackendStarting] = useState(false);
  const [triggerDropped, setTriggerDropped] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const [sort, setSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedRows = useMemo(() => sortRows(status.today_screener ?? [], sort), [status.today_screener, sort]);
  const isRunning = status.status === 'running';

  const stopPolling = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    abortController.current?.abort();
  };

  // `attempt` only counts consecutive backend-unavailable responses (see
  // BackendStartingNotice) - a healthy response resets it, so a
  // long-running scan's own is_running polling never trips it.
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
    setError('');
    setTriggerDropped(false);
    const outcome = await runBackendAwareMutation({
      url: '/api/research/volatility/today/start',
      stopPolling,
      fetchLatest: pollStatus,
      setTriggerDropped,
      setError,
    });
    if (!outcome.ok) return;
    setStatus(outcome.data as TodayScanStatus);
    stopPolling();
    pollTimer.current = setTimeout(() => pollStatus(), POLL_INTERVAL_MS);
  };

  const handleDownload = () => {
    const csv = rowsToCsv(sortedRows, TODAY_SCREENER_CSV_COLUMNS);
    downloadCsv(`swiss-${UNIVERSE_LABEL}-today-${todayIso()}.csv`, csv);
  };

  useEffect(() => {
    pollStatus();
    return stopPolling;
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
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const [sort, setSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedRows = useMemo(() => sortRows(result.rows, sort), [result.rows, sort]);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    abortController.current?.abort();
  };

  // Same shape as useReboundScan's fetchResult above - polls while
  // is_running, whether that run was started by the cron or by
  // handleRefresh. is_running is shared across all three thresholds (one
  // scan run covers all of them - see scheduler._run_indicator_scans), so
  // this keeps polling under whichever threshold is currently selected
  // regardless of which one the in-progress scan happens to be about.
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
    const lastRunText = result.scan_run_at
      ? `The last scan ran at ${new Date(result.scan_run_at).toLocaleString()}.`
      : 'No scan has run yet.';
    const confirmed = window.confirm(
      `${lastRunText}\n\nRunning a new scan covers all three thresholds, makes live Yahoo Finance calls, and can take several minutes. Continue?`,
    );
    if (!confirmed) return;

    setError('');
    setTriggerDropped(false);
    const outcome = await runBackendAwareMutation({
      url: `/api/research/volatility/indicator/start?threshold_pct=${threshold}`,
      stopPolling,
      fetchLatest: () => fetchResult(threshold),
      setTriggerDropped,
      setError,
    });
    if (!outcome.ok) return;
    stopPolling();
    fetchResult(threshold);
  };

  // Separate from handleRefresh above - same "Refresh is always a hard
  // full scan, this retries only the failures" split as rebound's own
  // handleRetry. Covers every threshold in one call (no threshold_pct
  // needed - see the /retry route's own comment).
  const handleRetry = async () => {
    setError('');
    setTriggerDropped(false);
    const outcome = await runBackendAwareMutation({
      url: '/api/research/volatility/indicator/retry',
      stopPolling,
      fetchLatest: () => fetchResult(threshold),
      setTriggerDropped,
      setError,
    });
    if (!outcome.ok) return;
    stopPolling();
    fetchResult(threshold);
  };

  const handleDownload = () => {
    const csv = rowsToCsv(sortedRows, VOLATILITY_INDICATOR_CSV_COLUMNS);
    downloadCsv(`swiss-${UNIVERSE_LABEL}-volatility-indicator-${threshold}pct-${todayIso()}.csv`, csv);
  };

  // Fetches once on mount, then whenever the threshold selector changes
  // (a fresh read for that threshold, still subject to the same
  // is_running polling).
  useEffect(() => {
    stopPolling();
    fetchResult(threshold);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  return { result, loading, error, backendStarting, triggerDropped, threshold, setThreshold, sort, setSort, sortedRows, handleRefresh, handleRetry, handleDownload };
}
