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

// Rebound/today/indicator each have their own independent backend job
// as of 2026-08-19 (previously rebound+today shared one combined job/
// button - split apart at the user's explicit request) - so each gets
// its own status shape/state/poll timer/button below, not one shared
// ScanStatus the way this page used to have.
interface ReboundScanStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  started_at?: string;
  finished_at?: string;
  universe_size?: number;
  crash_rebound?: CrashReboundRow[];
  error?: string;
}

interface TodayScanStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  started_at?: string;
  finished_at?: string;
  universe_size?: number;
  today_screener?: TodayScreenerRow[];
  error?: string;
}

interface IndicatorScanStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  started_at?: string;
  finished_at?: string;
  threshold_pct?: number;
  universe_size?: number;
  volatility_indicator?: VolatilityIndicatorRow[];
  error?: string;
}

const THRESHOLD_OPTIONS = [2, 3, 5] as const;

// Polling this often keeps the wait feeling responsive without coming
// close to the status routes' own 30-per-60s budget (see
// app/api/research/volatility/*/status/route.ts) - a 1-3 minute scan
// polled every 5s is at most ~36 requests total, spread out, not bursty.
const POLL_INTERVAL_MS = 5000;

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
  // isRunning drives the label text (THIS table's own scan), disabled
  // drives whether the button can be clicked at all - these are
  // deliberately separate props, not one flag: disabled also covers
  // "a DIFFERENT table's scan is running" (see isAnyScanRunning below),
  // where the button should be greyed out but must NOT claim to be
  // "Scanning…" itself, since it isn't.
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

function ErrorBanner({ label, message }: { label: string; message: string }) {
  return (
    <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '6px' }}>
      <strong>{label}:</strong> {message}
    </div>
  );
}

export default function VolatilityResearchPage() {
  const { data: session } = useSession();

  // --- Rebound scan state (own independent backend job) ---
  const [reboundStatus, setReboundStatus] = useState<ReboundScanStatus>({ status: 'idle' });
  const [reboundError, setReboundError] = useState('');
  const reboundPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [crashSort, setCrashSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedCrashRebound = useMemo(
    () => sortRows(reboundStatus.crash_rebound ?? [], crashSort),
    [reboundStatus.crash_rebound, crashSort],
  );
  const isReboundRunning = reboundStatus.status === 'running';

  // --- Today/big-loss scan state (own independent backend job) ---
  const [todayStatus, setTodayStatus] = useState<TodayScanStatus>({ status: 'idle' });
  const [todayError, setTodayError] = useState('');
  const todayPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [todaySort, setTodaySort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedTodayScreener = useMemo(
    () => sortRows(todayStatus.today_screener ?? [], todaySort),
    [todayStatus.today_screener, todaySort],
  );
  const isTodayRunning = todayStatus.status === 'running';

  // --- Volatility-indicator scan state (own independent backend job) ---
  const [indicatorStatus, setIndicatorStatus] = useState<IndicatorScanStatus>({ status: 'idle' });
  const [indicatorError, setIndicatorError] = useState('');
  const [indicatorThreshold, setIndicatorThreshold] = useState<number>(THRESHOLD_OPTIONS[0]);
  const indicatorPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [indicatorSort, setIndicatorSort] = useState<SortState>({ key: null, direction: 'asc' });
  const sortedVolatilityIndicator = useMemo(
    () => sortRows(indicatorStatus.volatility_indicator ?? [], indicatorSort),
    [indicatorStatus.volatility_indicator, indicatorSort],
  );
  const isIndicatorRunning = indicatorStatus.status === 'running';

  // Confirmed live: running two of these scans at once (e.g. Indicator
  // + Rebound in parallel) roughly doubles concurrent Yahoo calls
  // (~150 each), which is enough to trip Yahoo's rate limiting -
  // filter_domestic fails soft per-ticker, so a rate-limited run doesn't
  // error, it just silently comes back with universe_size: 0 and no
  // matches, which is confusing since nothing LOOKS like it failed.
  // Disabling all three Refresh buttons while ANY of them is running
  // (not just each button's own isRunning) forces scans to run
  // sequentially instead - each pays its own ~150-call cost, but never
  // overlapping with another's.
  const isAnyScanRunning = isReboundRunning || isTodayRunning || isIndicatorRunning;

  // --- Rebound polling/refresh ---

  const stopReboundPolling = () => {
    if (reboundPollTimer.current) {
      clearTimeout(reboundPollTimer.current);
      reboundPollTimer.current = null;
    }
  };

  const pollReboundStatus = async (): Promise<void> => {
    try {
      const response = await fetch('/api/research/volatility/rebound/status');
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setReboundError(data?.error || `Server returned status ${response.status}`);
        stopReboundPolling();
        return;
      }
      const parsed = data as ReboundScanStatus;
      setReboundStatus(parsed);
      if (parsed.status === 'running') {
        reboundPollTimer.current = setTimeout(pollReboundStatus, POLL_INTERVAL_MS);
      }
    } catch {
      setReboundError('Lost connection while checking scan status.');
      stopReboundPolling();
    }
  };

  const handleReboundRefresh = async () => {
    setReboundError('');
    try {
      const response = await fetch('/api/research/volatility/rebound/start', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setReboundError(data?.error || `Server returned status ${response.status}`);
        return;
      }
      setReboundStatus(data as ReboundScanStatus);
      stopReboundPolling();
      reboundPollTimer.current = setTimeout(pollReboundStatus, POLL_INTERVAL_MS);
    } catch {
      setReboundError('Failed to reach the research backend.');
    }
  };

  // --- Today/big-loss polling/refresh ---

  const stopTodayPolling = () => {
    if (todayPollTimer.current) {
      clearTimeout(todayPollTimer.current);
      todayPollTimer.current = null;
    }
  };

  const pollTodayStatus = async (): Promise<void> => {
    try {
      const response = await fetch('/api/research/volatility/today/status');
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setTodayError(data?.error || `Server returned status ${response.status}`);
        stopTodayPolling();
        return;
      }
      const parsed = data as TodayScanStatus;
      setTodayStatus(parsed);
      if (parsed.status === 'running') {
        todayPollTimer.current = setTimeout(pollTodayStatus, POLL_INTERVAL_MS);
      }
    } catch {
      setTodayError('Lost connection while checking scan status.');
      stopTodayPolling();
    }
  };

  const handleTodayRefresh = async () => {
    setTodayError('');
    try {
      const response = await fetch('/api/research/volatility/today/start', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setTodayError(data?.error || `Server returned status ${response.status}`);
        return;
      }
      setTodayStatus(data as TodayScanStatus);
      stopTodayPolling();
      todayPollTimer.current = setTimeout(pollTodayStatus, POLL_INTERVAL_MS);
    } catch {
      setTodayError('Failed to reach the research backend.');
    }
  };

  // --- Volatility-indicator polling/refresh ---

  const stopIndicatorPolling = () => {
    if (indicatorPollTimer.current) {
      clearTimeout(indicatorPollTimer.current);
      indicatorPollTimer.current = null;
    }
  };

  const pollIndicatorStatus = async (): Promise<void> => {
    try {
      const response = await fetch('/api/research/volatility/indicator/status');
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setIndicatorError(data?.error || `Server returned status ${response.status}`);
        stopIndicatorPolling();
        return;
      }
      const parsed = data as IndicatorScanStatus;
      setIndicatorStatus(parsed);
      if (parsed.status === 'running') {
        indicatorPollTimer.current = setTimeout(pollIndicatorStatus, POLL_INTERVAL_MS);
      }
    } catch {
      setIndicatorError('Lost connection while checking scan status.');
      stopIndicatorPolling();
    }
  };

  const handleIndicatorRefresh = async () => {
    setIndicatorError('');
    try {
      const response = await fetch(
        `/api/research/volatility/indicator/start?threshold_pct=${indicatorThreshold}`,
        { method: 'POST' },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setIndicatorError(data?.error || `Server returned status ${response.status}`);
        return;
      }
      setIndicatorStatus(data as IndicatorScanStatus);
      stopIndicatorPolling();
      indicatorPollTimer.current = setTimeout(pollIndicatorStatus, POLL_INTERVAL_MS);
    } catch {
      setIndicatorError('Failed to reach the research backend.');
    }
  };

  // On load: all three tables only POLL their current status (so a page
  // reload mid-scan still shows "running" and resumes polling, and
  // whatever's already been computed today shows immediately with no
  // click needed) - none of them auto-START a new scan anymore (changed
  // 2026-08-19 at the user's explicit request: rebound/today used to
  // auto-refresh on a stale/empty result on every page load, which the
  // user found surprising - now every table's Refresh button is the
  // only thing that ever starts a new scan, symmetric across all three).
  useEffect(() => {
    pollReboundStatus();
    return stopReboundPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pollTodayStatus();
    return stopTodayPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pollIndicatorStatus();
    return stopIndicatorPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            research, not investment advice. Each table below has its own independent Refresh button and scan.
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
        <h3 style={{ marginBottom: '4px' }}>Indicator of volatility (12 months)</h3>
        <p style={{ color: '#666', fontSize: '13px', marginTop: 0 }}>
          Same universe as the other tables below. Shows companies that had AT LEAST ONE trading day closing
          down by the selected % or more AND at least one day closing up by the selected % or more, over the
          last 12 months - a company with only losses or only gains is omitted. Not run automatically - pick
          a threshold and click Refresh.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#666' }}>
            Threshold:
            <select
              value={indicatorThreshold}
              disabled={isAnyScanRunning}
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
          <RefreshButton onClick={handleIndicatorRefresh} isRunning={isIndicatorRunning} disabled={isAnyScanRunning} />
          {indicatorStatus.status === 'done' && indicatorStatus.finished_at && (
            <span style={{ color: '#666', fontSize: '13px' }}>
              Last run ({indicatorStatus.threshold_pct}%): {new Date(indicatorStatus.finished_at).toLocaleString()}
              {' · '}
              {indicatorStatus.universe_size} tickers scanned
            </span>
          )}
          {indicatorStatus.status === 'idle' && <span style={{ color: '#666', fontSize: '13px' }}>No scan run yet.</span>}
        </div>

        {indicatorError && <ErrorBanner label="Error" message={indicatorError} />}
        {indicatorStatus.status === 'error' && indicatorStatus.error && (
          <ErrorBanner label="Scan failed" message={indicatorStatus.error} />
        )}

        {indicatorStatus.status === 'done' && (indicatorStatus.volatility_indicator?.length ?? 0) === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No matches in the last run.</p>
        )}
        {indicatorStatus.status === 'done' && (indicatorStatus.volatility_indicator?.length ?? 0) > 0 && (
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
                      <strong>{row.ticker}</strong>
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
          previous day - still-falling days don&apos;t quietly count as progress). Cached once per day - Refresh
          gets a new day&apos;s data, not a re-scan of today&apos;s already-cached result.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <RefreshButton onClick={handleReboundRefresh} isRunning={isReboundRunning} disabled={isAnyScanRunning} />
          {reboundStatus.status === 'done' && reboundStatus.finished_at && (
            <span style={{ color: '#666', fontSize: '13px' }}>
              Last run: {new Date(reboundStatus.finished_at).toLocaleString()} · {reboundStatus.universe_size} tickers scanned
            </span>
          )}
          {reboundStatus.status === 'idle' && <span style={{ color: '#666', fontSize: '13px' }}>No scan run yet.</span>}
        </div>

        {reboundError && <ErrorBanner label="Error" message={reboundError} />}
        {reboundStatus.status === 'error' && reboundStatus.error && (
          <ErrorBanner label="Scan failed" message={reboundStatus.error} />
        )}

        {reboundStatus.status === 'done' && (reboundStatus.crash_rebound?.length ?? 0) === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No matches in the last run.</p>
        )}
        {reboundStatus.status === 'done' && (reboundStatus.crash_rebound?.length ?? 0) > 0 && (
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
                      <strong>{row.ticker}</strong>
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

      <section style={{ marginTop: '32px' }}>
        <h3 style={{ marginBottom: '4px' }}>Big loss (today)</h3>
        <p style={{ color: '#666', fontSize: '13px', marginTop: 0 }}>
          Down 5%+ today, thinnest volume first. Own independent scan - click Refresh to update.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <RefreshButton onClick={handleTodayRefresh} isRunning={isTodayRunning} disabled={isAnyScanRunning} />
          {todayStatus.status === 'done' && todayStatus.finished_at && (
            <span style={{ color: '#666', fontSize: '13px' }}>
              Last run: {new Date(todayStatus.finished_at).toLocaleString()} · {todayStatus.universe_size} tickers scanned
            </span>
          )}
          {todayStatus.status === 'idle' && <span style={{ color: '#666', fontSize: '13px' }}>No scan run yet.</span>}
        </div>

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
                      <strong>{row.ticker}</strong>
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
    </main>
  );
}
