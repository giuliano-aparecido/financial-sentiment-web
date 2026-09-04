'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { signOutToLogin } from '@/lib/signOutToLogin';

interface CrashReboundRow {
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

interface TodayScreenerRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: number | null;
  price: number | null;
  change_pct: number;
  volume_today: number;
  avg_volume_10d: number | null;
}

interface VolatilityIndicatorRow {
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
interface ReboundScanResult {
  rows: CrashReboundRow[];
  scan_run_at: string | null;
  is_running: boolean;
  failed_ticker_count: number;
}

interface IndicatorScanResult {
  rows: VolatilityIndicatorRow[];
  scan_run_at: string | null;
  is_running: boolean;
  failed_ticker_count: number;
}

interface TodayScanStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  started_at?: string;
  finished_at?: string;
  universe_size?: number;
  today_screener?: TodayScreenerRow[];
  error?: string;
}

const THRESHOLD_OPTIONS = [2, 3, 5] as const;

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

function isBackendUnavailableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

// Shared by all three fetch/poll functions' not-ok and catch branches.
// Returning a bool rather than throwing/void keeps each call site a
// one-line `if`.
function scheduleBackendRetry(
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  setBackendStarting: (starting: boolean) => void,
  attempt: number,
  retry: (nextAttempt: number) => void,
): boolean {
  if (attempt >= BACKEND_STARTUP_MAX_ATTEMPTS) return false;
  setBackendStarting(true);
  timerRef.current = setTimeout(() => retry(attempt + 1), POLL_INTERVAL_MS);
  return true;
}

// The POST itself is abandoned rather than retried - no idempotency
// machinery to safely retry a state-mutating request against a gateway
// that may have received-but-not-acked it. See RequestNotSentNotice for
// the user-facing side of setTriggerDropped.
function fallBackToPassiveRefresh(
  stopPolling: () => void,
  fetchLatest: () => void,
  setTriggerDropped: (dropped: boolean) => void,
): void {
  setTriggerDropped(true);
  stopPolling();
  fetchLatest();
}

function formatMarketCap(value: number | null): string {
  if (value == null) return 'N/A';
  if (value >= 1e9) return `CHF ${(value / 1e9).toFixed(2)}B`;
  return `CHF ${(value / 1e6).toFixed(0)}M`;
}

function formatVolume(value: number | null): string {
  return value == null ? 'N/A' : value.toLocaleString();
}

function formatPrice(value: number | null): string {
  return value == null ? 'N/A' : `CHF ${value.toFixed(2)}`;
}

function formatPct(value: number | null, signed = false): string {
  if (value == null) return 'N/A';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

interface CsvColumn<T> {
  key: Extract<keyof T, string>;
  label: string;
}

// Column lists for CSV export, kept separate from the <table> JSX below
// rather than driving both from one shared definition - the table cells
// have per-column formatting/coloring (CHF prefixes, +/- signs, red/green)
// that isn't worth generalizing into a render-prop just for this. That
// means these lists need to be kept in sync BY HAND with the <thead>
// columns below if either changes - these columns have already changed
// five times over this page's life, so don't forget this list when they
// change again.
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

const cellStyle: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #eee', fontSize: '13px' };
const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 'bold',
  color: '#666',
  textAlign: 'left',
  borderBottom: '2px solid #ddd',
  whiteSpace: 'nowrap',
};

type SortDirection = 'asc' | 'desc';
type SortState = { key: string | null; direction: SortDirection };

// Generic over the row shape so all three tables (different columns)
// share one implementation. Nulls always sort last regardless of
// direction - "no data" isn't meaningfully "low" or "high", and burying
// it at the bottom either way is less surprising than it jumping to the
// top on a descending sort.
function sortRows<T extends object>(rows: T[], sort: SortState): T[] {
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

function toggleSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, direction: 'asc' };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

function DownloadCsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: '8px',
        padding: '6px 14px',
        backgroundColor: 'transparent',
        color: '#0070f3',
        border: '1px solid #0070f3',
        borderRadius: '6px',
        fontSize: '13px',
        cursor: 'pointer',
      }}
    >
      Download CSV
    </button>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  title,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  title?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      style={{ ...headerCellStyle, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={title}
    >
      {label}
      <span style={{ color: active ? '#0070f3' : '#ccc', marginLeft: '4px' }}>
        {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  );
}

function RefreshButton({
  onClick,
  isRunning,
  disabled,
  label = 'Refresh',
}: {
  onClick: () => void;
  isRunning: boolean;
  disabled: boolean;
  label?: string;
}) {
  // isRunning drives the label text, disabled drives whether the button
  // can be clicked at all - kept as separate props. All three tables use
  // this now: rebound/indicator's isRunning reflects scheduler.py's
  // is_*_scan_running() (true for a cron-started run too, not just one
  // this button itself triggered - see ReboundScanResult/
  // IndicatorScanResult's own comment), today's reflects its own
  // research_job.py job-slot status.
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 20px',
        backgroundColor: disabled ? '#888' : '#0070f3',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontSize: '15px',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {isRunning ? 'Scanning… (1-3 min)' : disabled ? 'Waiting for another scan…' : label}
    </button>
  );
}

function TickerLink({ ticker }: { ticker: string }) {
  return (
    <a
      href={`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'inherit', fontWeight: 'bold', textDecoration: 'underline', textDecorationColor: '#ccc' }}
    >
      {ticker}
    </a>
  );
}

function ErrorBanner({ label, message }: { label: string; message: string }) {
  return (
    <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '6px' }}>
      <strong>{label}:</strong> {message}
    </div>
  );
}

function InfoNotice({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        padding: '12px',
        backgroundColor: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: '6px',
        color: '#1e40af',
        fontSize: '13px',
      }}
    >
      {children}
    </p>
  );
}

// Shown INSTEAD OF the table while a scan is running - whether that run
// was started by the cron or by this table's own Refresh button, they're
// indistinguishable here on purpose (see ReboundScanResult/
// IndicatorScanResult's own comment).
function ScanInProgressNotice() {
  return (
    <InfoNotice>
      A scan is currently running (started automatically or manually) - this can take several minutes. This
      table will update automatically once it&apos;s done.
    </InfoNotice>
  );
}

// Shown instead of a hard error while the status/result fetch is failing
// with a backend-unavailable signal (502/503/504, or the request not
// connecting at all) - financial-sentiment-api is hosted on Render, whose
// free tier spins the app down after idle and can take up to ~a minute to
// come back up ("Waiting for application startup." in its logs). The
// fetchers below keep retrying silently through that window instead of
// surfacing it as a failure - see BACKEND_STARTUP_MAX_ATTEMPTS.
function BackendStartingNotice() {
  return (
    <InfoNotice>
      Waiting for the research backend to start up - this can take up to a minute after it&apos;s been idle.
      Retrying automatically…
    </InfoNotice>
  );
}

// Shown after a manual Refresh/Retry click hits a cold backend (see
// BackendStartingNotice's own comment) - unlike that passive notice,
// nothing here is retrying the click itself, only the read that fetches
// the last known result (see fallBackToPassiveRefresh's own comment) - so
// this says so explicitly instead of reusing BackendStartingNotice's
// "Retrying automatically…", which would be false for this path.
function RequestNotSentNotice() {
  return (
    <InfoNotice>
      That request may not have gone through - the backend was still starting up. Wait for it to come back
      (see below), then click again.
    </InfoNotice>
  );
}

// Shown when the last completed scan couldn't fetch every ticker (e.g.
// Yahoo rate-limiting mid-scan) - the table below is real but incomplete,
// not a display bug. Refresh only retries these specific tickers rather
// than redoing the whole scan (see financial-sentiment-api's
// scheduler.py: trigger_rebound_scan/trigger_indicator_scan).
function IncompleteScanWarning({ count }: { count: number }) {
  return (
    <p
      style={{
        padding: '12px',
        backgroundColor: '#fef9c3',
        border: '1px solid #fde047',
        borderRadius: '6px',
        color: '#854d0e',
        fontSize: '13px',
      }}
    >
      <strong>{count}</strong> {count === 1 ? 'company' : 'companies'} failed to fetch and{' '}
      {count === 1 ? 'is' : 'are'} missing from this table (temporary fetch error, not excluded on purpose).
      Click &quot;Retry Failed Tickers&quot; below to retry just {count === 1 ? 'it' : 'those'}.
    </p>
  );
}

export default function VolatilityResearchPage() {
  const { data: session } = useSession();

  // --- Rebound: reads the latest scheduled scan; manual Refresh triggers
  // the same guarded pipeline the cron uses (see interfaces' own comment) ---
  const [reboundResult, setReboundResult] = useState<ReboundScanResult>({ rows: [], scan_run_at: null, is_running: false, failed_ticker_count: 0 });
  const [reboundLoading, setReboundLoading] = useState(true);
  const [reboundError, setReboundError] = useState('');
  const [reboundBackendStarting, setReboundBackendStarting] = useState(false);
  const [reboundTriggerDropped, setReboundTriggerDropped] = useState(false);
  const reboundPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [crashSort, setCrashSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedCrashRebound = useMemo(
    () => sortRows(reboundResult.rows, crashSort),
    [reboundResult.rows, crashSort],
  );

  // --- Today/big-loss scan state (own independent backend job - unchanged,
  // still fully live/on-demand, see the interface's own comment) ---
  const [todayStatus, setTodayStatus] = useState<TodayScanStatus>({ status: 'idle' });
  const [todayError, setTodayError] = useState('');
  const [todayBackendStarting, setTodayBackendStarting] = useState(false);
  const [todayTriggerDropped, setTodayTriggerDropped] = useState(false);
  const todayPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [todaySort, setTodaySort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedTodayScreener = useMemo(
    () => sortRows(todayStatus.today_screener ?? [], todaySort),
    [todayStatus.today_screener, todaySort],
  );
  const isTodayRunning = todayStatus.status === 'running';

  // --- Volatility-indicator: reads the latest scheduled scan for the
  // selected threshold; manual Refresh triggers a run covering ALL
  // thresholds (see interfaces' own comment and IndicatorScanResult) ---
  const [indicatorResult, setIndicatorResult] = useState<IndicatorScanResult>({ rows: [], scan_run_at: null, is_running: false, failed_ticker_count: 0 });
  const [indicatorLoading, setIndicatorLoading] = useState(true);
  const [indicatorError, setIndicatorError] = useState('');
  const [indicatorBackendStarting, setIndicatorBackendStarting] = useState(false);
  const [indicatorTriggerDropped, setIndicatorTriggerDropped] = useState(false);
  const [indicatorThreshold, setIndicatorThreshold] = useState<number>(THRESHOLD_OPTIONS[0]);
  const indicatorPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [indicatorSort, setIndicatorSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedVolatilityIndicator = useMemo(
    () => sortRows(indicatorResult.rows, indicatorSort),
    [indicatorResult.rows, indicatorSort],
  );

  // --- Rebound fetch/poll/trigger ---

  const stopReboundPolling = () => {
    if (reboundPollTimer.current) {
      clearTimeout(reboundPollTimer.current);
      reboundPollTimer.current = null;
    }
  };

  // Fetches the current result and, if a scan is running (started by the
  // cron OR by handleReboundRefresh below - indistinguishable and that's
  // the point, see interfaces' own comment), keeps polling every 5s until
  // it isn't. Called on mount AND right after a manual trigger, so both
  // paths converge on the same loop. `attempt` only counts consecutive
  // backend-unavailable responses (see BackendStartingNotice) - a healthy
  // response resets it, so a long-running is_running poll never trips it.
  const fetchReboundResult = async (attempt = 0): Promise<void> => {
    setReboundError('');
    try {
      const response = await fetch('/api/research/volatility/rebound');
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (isBackendUnavailableStatus(response.status) && scheduleBackendRetry(reboundPollTimer, setReboundBackendStarting, attempt, fetchReboundResult)) {
          return;
        }
        setReboundBackendStarting(false);
        setReboundTriggerDropped(false);
        setReboundError(data?.error || `Server returned status ${response.status}`);
        stopReboundPolling();
        return;
      }
      setReboundBackendStarting(false);
      setReboundTriggerDropped(false);
      const parsed = data as ReboundScanResult;
      setReboundResult(parsed);
      if (parsed.is_running) {
        reboundPollTimer.current = setTimeout(() => fetchReboundResult(), POLL_INTERVAL_MS);
      } else {
        stopReboundPolling();
      }
    } catch {
      if (scheduleBackendRetry(reboundPollTimer, setReboundBackendStarting, attempt, fetchReboundResult)) {
        return;
      }
      setReboundBackendStarting(false);
      setReboundTriggerDropped(false);
      setReboundError('Failed to reach the research backend.');
      stopReboundPolling();
    } finally {
      setReboundLoading(false);
    }
  };

  const handleReboundRefresh = async () => {
    const lastRunText = reboundResult.scan_run_at
      ? `The last scan ran at ${new Date(reboundResult.scan_run_at).toLocaleString()}.`
      : 'No scan has run yet.';
    const confirmed = window.confirm(
      `${lastRunText}\n\nRunning a new scan makes live Yahoo Finance calls and can take several minutes. Continue?`,
    );
    if (!confirmed) return;

    setReboundError('');
    setReboundTriggerDropped(false);
    try {
      const response = await fetch('/api/research/volatility/rebound/start', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // A cold backend can fail the POST itself, not just the polling
        // GET it would normally trigger - see fallBackToPassiveRefresh's
        // own comment for why this falls back rather than erroring.
        if (isBackendUnavailableStatus(response.status)) {
          fallBackToPassiveRefresh(stopReboundPolling, fetchReboundResult, setReboundTriggerDropped);
          return;
        }
        setReboundError(data?.error || `Server returned status ${response.status}`);
        return;
      }
      stopReboundPolling();
      fetchReboundResult();
    } catch {
      fallBackToPassiveRefresh(stopReboundPolling, fetchReboundResult, setReboundTriggerDropped);
    }
  };

  // Separate from handleReboundRefresh above - Refresh is always a hard,
  // full scan (see ReboundScanResult's own comment); this retries ONLY
  // the tickers that failed on the last scan. No confirm() dialog - it's
  // a small, fast operation (a handful of tickers, not the whole
  // universe), unlike a full scan.
  const handleReboundRetry = async () => {
    setReboundError('');
    setReboundTriggerDropped(false);
    try {
      const response = await fetch('/api/research/volatility/rebound/retry', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (isBackendUnavailableStatus(response.status)) {
          fallBackToPassiveRefresh(stopReboundPolling, fetchReboundResult, setReboundTriggerDropped);
          return;
        }
        setReboundError(data?.error || `Server returned status ${response.status}`);
        return;
      }
      stopReboundPolling();
      fetchReboundResult();
    } catch {
      fallBackToPassiveRefresh(stopReboundPolling, fetchReboundResult, setReboundTriggerDropped);
    }
  };

  // --- Today/big-loss polling/refresh ---

  const stopTodayPolling = () => {
    if (todayPollTimer.current) {
      clearTimeout(todayPollTimer.current);
      todayPollTimer.current = null;
    }
  };

  // `attempt` only counts consecutive backend-unavailable responses (see
  // BackendStartingNotice) - a healthy response resets it, so a
  // long-running scan's own is_running polling never trips it.
  const pollTodayStatus = async (attempt = 0): Promise<void> => {
    try {
      const response = await fetch('/api/research/volatility/today/status');
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (isBackendUnavailableStatus(response.status) && scheduleBackendRetry(todayPollTimer, setTodayBackendStarting, attempt, pollTodayStatus)) {
          return;
        }
        setTodayBackendStarting(false);
        setTodayTriggerDropped(false);
        setTodayError(data?.error || `Server returned status ${response.status}`);
        stopTodayPolling();
        return;
      }
      setTodayBackendStarting(false);
      setTodayTriggerDropped(false);
      const parsed = data as TodayScanStatus;
      setTodayStatus(parsed);
      if (parsed.status === 'running') {
        todayPollTimer.current = setTimeout(() => pollTodayStatus(), POLL_INTERVAL_MS);
      }
    } catch {
      if (scheduleBackendRetry(todayPollTimer, setTodayBackendStarting, attempt, pollTodayStatus)) {
        return;
      }
      setTodayBackendStarting(false);
      setTodayTriggerDropped(false);
      setTodayError('Lost connection while checking scan status.');
      stopTodayPolling();
    }
  };

  const handleTodayRefresh = async () => {
    setTodayError('');
    setTodayTriggerDropped(false);
    try {
      const response = await fetch('/api/research/volatility/today/start', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (isBackendUnavailableStatus(response.status)) {
          fallBackToPassiveRefresh(stopTodayPolling, pollTodayStatus, setTodayTriggerDropped);
          return;
        }
        setTodayError(data?.error || `Server returned status ${response.status}`);
        return;
      }
      setTodayStatus(data as TodayScanStatus);
      stopTodayPolling();
      todayPollTimer.current = setTimeout(pollTodayStatus, POLL_INTERVAL_MS);
    } catch {
      fallBackToPassiveRefresh(stopTodayPolling, pollTodayStatus, setTodayTriggerDropped);
    }
  };

  // --- Volatility-indicator fetch/poll/trigger ---

  const stopIndicatorPolling = () => {
    if (indicatorPollTimer.current) {
      clearTimeout(indicatorPollTimer.current);
      indicatorPollTimer.current = null;
    }
  };

  // Same shape as fetchReboundResult above - polls while is_running,
  // whether that run was started by the cron or by handleIndicatorRefresh.
  // is_running is shared across all three thresholds (one scan run covers
  // all of them - see scheduler._run_indicator_scans), so this keeps
  // polling under whichever threshold is currently selected regardless of
  // which one the in-progress scan happens to be about.
  const fetchIndicatorResult = async (thresholdPct: number, attempt = 0): Promise<void> => {
    setIndicatorError('');
    try {
      const response = await fetch(`/api/research/volatility/indicator?threshold_pct=${thresholdPct}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (isBackendUnavailableStatus(response.status) && scheduleBackendRetry(indicatorPollTimer, setIndicatorBackendStarting, attempt, (next) => fetchIndicatorResult(thresholdPct, next))) {
          return;
        }
        setIndicatorBackendStarting(false);
        setIndicatorTriggerDropped(false);
        setIndicatorError(data?.error || `Server returned status ${response.status}`);
        stopIndicatorPolling();
        return;
      }
      setIndicatorBackendStarting(false);
      setIndicatorTriggerDropped(false);
      const parsed = data as IndicatorScanResult;
      setIndicatorResult(parsed);
      if (parsed.is_running) {
        indicatorPollTimer.current = setTimeout(() => fetchIndicatorResult(thresholdPct), POLL_INTERVAL_MS);
      } else {
        stopIndicatorPolling();
      }
    } catch {
      if (scheduleBackendRetry(indicatorPollTimer, setIndicatorBackendStarting, attempt, (next) => fetchIndicatorResult(thresholdPct, next))) {
        return;
      }
      setIndicatorBackendStarting(false);
      setIndicatorTriggerDropped(false);
      setIndicatorError('Failed to reach the research backend.');
      stopIndicatorPolling();
    } finally {
      setIndicatorLoading(false);
    }
  };

  const handleIndicatorRefresh = async () => {
    const lastRunText = indicatorResult.scan_run_at
      ? `The last scan ran at ${new Date(indicatorResult.scan_run_at).toLocaleString()}.`
      : 'No scan has run yet.';
    const confirmed = window.confirm(
      `${lastRunText}\n\nRunning a new scan covers all three thresholds, makes live Yahoo Finance calls, and can take several minutes. Continue?`,
    );
    if (!confirmed) return;

    setIndicatorError('');
    setIndicatorTriggerDropped(false);
    try {
      const response = await fetch(
        `/api/research/volatility/indicator/start?threshold_pct=${indicatorThreshold}`,
        { method: 'POST' },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (isBackendUnavailableStatus(response.status)) {
          fallBackToPassiveRefresh(stopIndicatorPolling, () => fetchIndicatorResult(indicatorThreshold), setIndicatorTriggerDropped);
          return;
        }
        setIndicatorError(data?.error || `Server returned status ${response.status}`);
        return;
      }
      stopIndicatorPolling();
      fetchIndicatorResult(indicatorThreshold);
    } catch {
      fallBackToPassiveRefresh(stopIndicatorPolling, () => fetchIndicatorResult(indicatorThreshold), setIndicatorTriggerDropped);
    }
  };

  // Separate from handleIndicatorRefresh above - same "Refresh is always
  // a hard full scan, this retries only the failures" split as rebound's
  // own handleReboundRetry. Covers every threshold in one call (no
  // threshold_pct needed - see the /retry route's own comment).
  const handleIndicatorRetry = async () => {
    setIndicatorError('');
    setIndicatorTriggerDropped(false);
    try {
      const response = await fetch('/api/research/volatility/indicator/retry', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (isBackendUnavailableStatus(response.status)) {
          fallBackToPassiveRefresh(stopIndicatorPolling, () => fetchIndicatorResult(indicatorThreshold), setIndicatorTriggerDropped);
          return;
        }
        setIndicatorError(data?.error || `Server returned status ${response.status}`);
        return;
      }
      stopIndicatorPolling();
      fetchIndicatorResult(indicatorThreshold);
    } catch {
      fallBackToPassiveRefresh(stopIndicatorPolling, () => fetchIndicatorResult(indicatorThreshold), setIndicatorTriggerDropped);
    }
  };

  // Rebound fetches once on mount, then polls only if a scan turns out to
  // be running. Indicator does the same on mount AND whenever the
  // threshold selector changes (a fresh read for that threshold, still
  // subject to the same is_running polling). Today keeps its original
  // poll-current-status-on-load behavior unchanged, since it's still a
  // live/on-demand background job with its own separate status shape.
  useEffect(() => {
    fetchReboundResult();
    return stopReboundPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pollTodayStatus();
    return stopTodayPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stopIndicatorPolling();
    fetchIndicatorResult(indicatorThreshold);
    return stopIndicatorPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicatorThreshold]);

  const todayIso = () => new Date().toISOString().slice(0, 10);

  const universeLabel = 'chf500m-plus-ex-smi';

  const handleDownloadCrashRebound = () => {
    const csv = rowsToCsv(sortedCrashRebound, CRASH_REBOUND_CSV_COLUMNS);
    downloadCsv(`swiss-${universeLabel}-crash-rebound-${todayIso()}.csv`, csv);
  };

  const handleDownloadTodayScreener = () => {
    const csv = rowsToCsv(sortedTodayScreener, TODAY_SCREENER_CSV_COLUMNS);
    downloadCsv(`swiss-${universeLabel}-today-${todayIso()}.csv`, csv);
  };

  const handleDownloadVolatilityIndicator = () => {
    const csv = rowsToCsv(sortedVolatilityIndicator, VOLATILITY_INDICATOR_CSV_COLUMNS);
    downloadCsv(`swiss-${universeLabel}-volatility-indicator-${indicatorThreshold}pct-${todayIso()}.csv`, csv);
  };

  return (
    <main style={{ maxWidth: '1100px', margin: '40px auto', padding: '20px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>🇨🇭 Swiss Volatility Research</h2>
          <p style={{ color: '#666' }}>
            SIX Swiss Exchange, domestic only, looking for volatile movers (crash-then-rebound and big daily
            losses).{' '}
            Universe: market cap over CHF 500M, no upper bound - that is the only requirement.{' '}
            At least 50,000 shares traded on average over the last 10 days - thinly-traded names excluded. For
            research, not investment advice. Indicator and rebound are scanned automatically (monthly / daily) -
            each also has its own Refresh button to force an early run; Big loss (today) is always live/on-demand.
          </p>
        </div>
        {session?.user?.email && (
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap', marginLeft: '16px' }}>
            <div style={{ color: '#666', fontSize: '13px' }}>{session.user.email}</div>
            <button
              onClick={() => signOutToLogin()}
              style={{
                marginTop: '4px',
                padding: '4px 10px',
                backgroundColor: 'transparent',
                color: '#0070f3',
                border: '1px solid #0070f3',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      <section style={{ marginTop: '28px' }}>
        <h3 style={{ marginBottom: '4px' }}>Big loss (today)</h3>
        <p style={{ color: '#666', fontSize: '13px', marginTop: 0 }}>
          Down 5%+ today, thinnest volume first. Own independent scan - click Refresh to update.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <RefreshButton onClick={handleTodayRefresh} isRunning={isTodayRunning} disabled={isTodayRunning || todayBackendStarting} />
          {!todayBackendStarting && todayStatus.status === 'done' && todayStatus.finished_at && (
            <span style={{ color: '#666', fontSize: '13px' }}>
              Last run: {new Date(todayStatus.finished_at).toLocaleString()} · {todayStatus.universe_size} tickers scanned
            </span>
          )}
          {todayBackendStarting && <span style={{ color: '#666', fontSize: '13px' }}>Loading…</span>}
          {!todayBackendStarting && todayStatus.status === 'idle' && (
            <span style={{ color: '#666', fontSize: '13px' }}>No scan run yet.</span>
          )}
        </div>

        {todayTriggerDropped && <RequestNotSentNotice />}
        {todayBackendStarting && <BackendStartingNotice />}
        {todayError && <ErrorBanner label="Error" message={todayError} />}
        {todayStatus.status === 'error' && todayStatus.error && (
          <ErrorBanner label="Scan failed" message={todayStatus.error} />
        )}

        {todayStatus.status === 'done' && (todayStatus.today_screener?.length ?? 0) === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No matches today.</p>
        )}
        {todayStatus.status === 'done' && (todayStatus.today_screener?.length ?? 0) > 0 && (
          <>
            <DownloadCsvButton onClick={handleDownloadTodayScreener} />
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
              <thead>
                <tr>
                  <SortableHeader label="Ticker" sortKey="ticker" sort={todaySort} onSort={(k) => setTodaySort(toggleSort(todaySort, k))} />
                  <SortableHeader label="Name" sortKey="name" sort={todaySort} onSort={(k) => setTodaySort(toggleSort(todaySort, k))} />
                  <SortableHeader label="Sector" sortKey="sector" sort={todaySort} onSort={(k) => setTodaySort(toggleSort(todaySort, k))} />
                  <SortableHeader label="Market cap" sortKey="market_cap" sort={todaySort} onSort={(k) => setTodaySort(toggleSort(todaySort, k))} />
                  <SortableHeader label="Price" sortKey="price" sort={todaySort} onSort={(k) => setTodaySort(toggleSort(todaySort, k))} />
                  <SortableHeader label="Change %" sortKey="change_pct" sort={todaySort} onSort={(k) => setTodaySort(toggleSort(todaySort, k))} />
                  <SortableHeader label="Volume today" sortKey="volume_today" sort={todaySort} onSort={(k) => setTodaySort(toggleSort(todaySort, k))} />
                </tr>
              </thead>
              <tbody>
                {sortedTodayScreener.map((row, i) => (
                  <tr key={`${row.ticker}-${i}`}>
                    <td style={cellStyle}>
                      <TickerLink ticker={row.ticker} />
                    </td>
                    <td style={cellStyle}>{row.name}</td>
                    <td style={cellStyle}>{row.sector ?? 'N/A'}</td>
                    <td style={cellStyle}>{formatMarketCap(row.market_cap)}</td>
                    <td style={cellStyle}>{row.price != null ? `CHF ${row.price.toFixed(2)}` : 'N/A'}</td>
                    <td style={{ ...cellStyle, color: row.change_pct > 0 ? '#16a34a' : row.change_pct < 0 ? '#dc2626' : '#666' }}>
                      {row.change_pct > 0 ? '+' : ''}
                      {row.change_pct.toFixed(2)}%
                    </td>
                    <td style={cellStyle}>{row.volume_today.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>

      <section style={{ marginTop: '32px' }}>
        <h3 style={{ marginBottom: '4px' }}>Indicator of volatility (12 months)</h3>
        <p style={{ color: '#666', fontSize: '13px', marginTop: 0 }}>
          Same universe as the other tables below. Shows companies that had AT LEAST ONE trading day closing
          down by the selected % or more AND at least one day closing up by the selected % or more, over the
          last 12 months - a company with only losses or only gains is omitted. Scanned automatically once a
          month (see &quot;Last updated&quot; below); Refresh forces an early run covering all three thresholds.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#666' }}>
            Threshold:
            <select
              value={indicatorThreshold}
              disabled={indicatorLoading || indicatorBackendStarting}
              onChange={(e) => setIndicatorThreshold(Number(e.target.value))}
              style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '13px' }}
            >
              {THRESHOLD_OPTIONS.map((pct) => (
                <option key={pct} value={pct}>
                  {pct}%
                </option>
              ))}
            </select>
          </label>
          <RefreshButton
            onClick={handleIndicatorRefresh}
            isRunning={indicatorResult.is_running}
            disabled={indicatorLoading || indicatorBackendStarting || indicatorResult.is_running}
          />
          {!indicatorResult.is_running && indicatorResult.failed_ticker_count > 0 && (
            <RefreshButton
              onClick={handleIndicatorRetry}
              isRunning={false}
              disabled={indicatorLoading || indicatorBackendStarting}
              label={`Retry Failed Tickers (${indicatorResult.failed_ticker_count})`}
            />
          )}
          {(indicatorLoading || indicatorBackendStarting) && <span style={{ color: '#666', fontSize: '13px' }}>Loading…</span>}
          {!indicatorLoading && !indicatorBackendStarting && indicatorResult.scan_run_at && (
            <span style={{ color: '#666', fontSize: '13px' }}>
              Last updated ({indicatorThreshold}%): {new Date(indicatorResult.scan_run_at).toLocaleString()}
            </span>
          )}
          {!indicatorLoading && !indicatorBackendStarting && !indicatorResult.scan_run_at && (
            <span style={{ color: '#666', fontSize: '13px' }}>No scan has run yet.</span>
          )}
        </div>

        {indicatorTriggerDropped && <RequestNotSentNotice />}
        {indicatorBackendStarting && <BackendStartingNotice />}
        {indicatorError && <ErrorBanner label="Error" message={indicatorError} />}

        {indicatorResult.is_running && !indicatorBackendStarting && <ScanInProgressNotice />}
        {!indicatorResult.is_running && indicatorResult.failed_ticker_count > 0 && (
          <IncompleteScanWarning count={indicatorResult.failed_ticker_count} />
        )}

        {!indicatorLoading && !indicatorResult.is_running && indicatorResult.scan_run_at && indicatorResult.rows.length === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No matches in the last scan.</p>
        )}
        {!indicatorResult.is_running && indicatorResult.rows.length > 0 && (
          <>
            <DownloadCsvButton onClick={handleDownloadVolatilityIndicator} />
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
              <thead>
                <tr>
                  <SortableHeader label="Ticker" sortKey="ticker" sort={indicatorSort} onSort={(k) => setIndicatorSort(toggleSort(indicatorSort, k))} />
                  <SortableHeader label="Name" sortKey="name" sort={indicatorSort} onSort={(k) => setIndicatorSort(toggleSort(indicatorSort, k))} />
                  <SortableHeader label="Sector" sortKey="sector" sort={indicatorSort} onSort={(k) => setIndicatorSort(toggleSort(indicatorSort, k))} />
                  <SortableHeader label="Market cap" sortKey="market_cap" sort={indicatorSort} onSort={(k) => setIndicatorSort(toggleSort(indicatorSort, k))} />
                  <SortableHeader label="Loss days" sortKey="loss_days" sort={indicatorSort} onSort={(k) => setIndicatorSort(toggleSort(indicatorSort, k))} />
                  <SortableHeader label="Gain days" sortKey="gain_days" sort={indicatorSort} onSort={(k) => setIndicatorSort(toggleSort(indicatorSort, k))} />
                  <SortableHeader label="Total days" sortKey="total_days" sort={indicatorSort} onSort={(k) => setIndicatorSort(toggleSort(indicatorSort, k))} />
                </tr>
              </thead>
              <tbody>
                {sortedVolatilityIndicator.map((row, i) => (
                  <tr key={`${row.ticker}-${i}`}>
                    <td style={cellStyle}>
                      <TickerLink ticker={row.ticker} />
                    </td>
                    <td style={cellStyle}>{row.name}</td>
                    <td style={cellStyle}>{row.sector ?? 'N/A'}</td>
                    <td style={cellStyle}>{formatMarketCap(row.market_cap)}</td>
                    <td style={{ ...cellStyle, color: '#dc2626' }}>{row.loss_days}</td>
                    <td style={{ ...cellStyle, color: '#16a34a' }}>{row.gain_days}</td>
                    <td style={cellStyle}>
                      <strong>{row.total_days}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>

      <section style={{ marginTop: '32px' }}>
        <h3 style={{ marginBottom: '4px' }}>Indicator of rebound (12 months)</h3>
        <p style={{ color: '#666', fontSize: '13px', marginTop: 0 }}>
          Down 5%+, then within the next 3 trading days a close 5%+ above THAT crash-day close (not just vs. the
          previous day - still-falling days don&apos;t quietly count as progress). Scanned automatically once a
          day (see &quot;Last updated&quot; below); Refresh forces an early run.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <RefreshButton
            onClick={handleReboundRefresh}
            isRunning={reboundResult.is_running}
            disabled={reboundLoading || reboundBackendStarting || reboundResult.is_running}
          />
          {!reboundResult.is_running && reboundResult.failed_ticker_count > 0 && (
            <RefreshButton
              onClick={handleReboundRetry}
              isRunning={false}
              disabled={reboundLoading || reboundBackendStarting}
              label={`Retry Failed Tickers (${reboundResult.failed_ticker_count})`}
            />
          )}
          {(reboundLoading || reboundBackendStarting) && <span style={{ color: '#666', fontSize: '13px' }}>Loading…</span>}
          {!reboundLoading && !reboundBackendStarting && reboundResult.scan_run_at && (
            <span style={{ color: '#666', fontSize: '13px' }}>
              Last updated: {new Date(reboundResult.scan_run_at).toLocaleString()}
            </span>
          )}
          {!reboundLoading && !reboundBackendStarting && !reboundResult.scan_run_at && (
            <span style={{ color: '#666', fontSize: '13px' }}>No scan has run yet.</span>
          )}
        </div>

        {reboundTriggerDropped && <RequestNotSentNotice />}
        {reboundBackendStarting && <BackendStartingNotice />}
        {reboundError && <ErrorBanner label="Error" message={reboundError} />}

        {reboundResult.is_running && !reboundBackendStarting && <ScanInProgressNotice />}
        {!reboundResult.is_running && reboundResult.failed_ticker_count > 0 && (
          <IncompleteScanWarning count={reboundResult.failed_ticker_count} />
        )}

        {!reboundLoading && !reboundResult.is_running && reboundResult.scan_run_at && reboundResult.rows.length === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No matches in the last scan.</p>
        )}
        {!reboundResult.is_running && reboundResult.rows.length > 0 && (
          <>
            <DownloadCsvButton onClick={handleDownloadCrashRebound} />
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
              <thead>
                <tr>
                  <SortableHeader label="Ticker" sortKey="ticker" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Name" sortKey="name" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Sector" sortKey="sector" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Market cap" sortKey="market_cap" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader
                    label="ADTV"
                    sortKey="avg_volume_10d"
                    sort={crashSort}
                    onSort={(k) => setCrashSort(toggleSort(crashSort, k))}
                    title="Average daily trading volume over the last 10 days."
                  />
                  <SortableHeader label="Loss date" sortKey="loss_date" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Loss close" sortKey="loss_close" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Drop %" sortKey="drop_pct" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Days to rebound" sortKey="days_to_rebound" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Gain date" sortKey="gain_date" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Gain close" sortKey="gain_close" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader
                    label="Gain %"
                    sortKey="gain_pct"
                    sort={crashSort}
                    onSort={(k) => setCrashSort(toggleSort(crashSort, k))}
                    title="Cumulative gain from the crash-day close to the close on the rebound day (see Days to rebound) - not that day's own daily move."
                  />
                </tr>
              </thead>
              <tbody>
                {sortedCrashRebound.map((row, i) => (
                  <tr key={`${row.ticker}-${row.loss_date}-${i}`}>
                    <td style={cellStyle}>
                      <TickerLink ticker={row.ticker} />
                    </td>
                    <td style={cellStyle}>{row.name}</td>
                    <td style={cellStyle}>{row.sector ?? 'N/A'}</td>
                    <td style={cellStyle}>{formatMarketCap(row.market_cap)}</td>
                    <td style={cellStyle}>{formatVolume(row.avg_volume_10d)}</td>
                    <td style={cellStyle}>{row.loss_date}</td>
                    <td style={cellStyle}>{formatPrice(row.loss_close)}</td>
                    <td style={{ ...cellStyle, color: '#dc2626' }}>{formatPct(row.drop_pct)}</td>
                    <td style={cellStyle}>{row.days_to_rebound}</td>
                    <td style={cellStyle}>{row.gain_date}</td>
                    <td style={cellStyle}>{formatPrice(row.gain_close)}</td>
                    <td style={{ ...cellStyle, color: '#16a34a' }}>{formatPct(row.gain_pct, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>

    </main>
  );
}
