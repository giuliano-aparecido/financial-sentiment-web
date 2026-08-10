'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { signOutToLogin } from '@/lib/signOutToLogin';

interface CrashReboundRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: number | null;
  loss_date: string;
  loss_close: number;
  loss_volume: number | null;
  drop_pct: number;
  gain_date: string;
  gain_close: number;
  gain_volume: number | null;
  gain_pct: number;
}

interface TodayScreenerRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: number | null;
  price: number | null;
  change_pct: number;
  volume_today: number;
  avg_volume_3mo: number | null;
}

interface ScanStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  started_at?: string;
  finished_at?: string;
  universe_size?: number;
  crash_rebound?: CrashReboundRow[];
  today_screener?: TodayScreenerRow[];
  error?: string;
}

// Polling this often keeps the wait feeling responsive without coming
// close to the status route's own 30-per-60s budget (see
// app/api/research/small-caps/status/route.ts) - a 1-3 minute scan polled
// every 5s is at most ~36 requests total, spread out, not bursty.
const POLL_INTERVAL_MS = 5000;

function formatMarketCap(value: number | null): string {
  if (value == null) return 'N/A';
  if (value >= 1e9) return `CHF ${(value / 1e9).toFixed(2)}B`;
  return `CHF ${(value / 1e6).toFixed(0)}M`;
}

function formatVolume(value: number | null): string {
  return value == null ? 'N/A' : value.toLocaleString();
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
  { key: 'loss_date', label: 'Loss date' },
  { key: 'loss_close', label: 'Loss close' },
  { key: 'loss_volume', label: 'Loss volume' },
  { key: 'drop_pct', label: 'Drop %' },
  { key: 'gain_date', label: 'Gain date' },
  { key: 'gain_close', label: 'Gain close' },
  { key: 'gain_volume', label: 'Gain volume' },
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

// Generic over the row shape so both tables (different columns) share one
// implementation. Nulls always sort last regardless of direction - "no
// data" isn't meaningfully "low" or "high", and burying it at the bottom
// either way is less surprising than it jumping to the top on a
// descending sort.
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
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      style={{ ...headerCellStyle, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span style={{ color: active ? '#0070f3' : '#ccc', marginLeft: '4px' }}>
        {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  );
}

export default function SmallCapsReboundPage() {
  const { data: session } = useSession();
  const [status, setStatus] = useState<ScanStatus>({ status: 'idle' });
  const [error, setError] = useState('');
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Default to null (backend order: loss_date desc / volume ratio asc -
  // see research_job.py's callers) until the user clicks a header.
  const [crashSort, setCrashSort] = useState<SortState>({ key: null, direction: 'asc' });
  const [todaySort, setTodaySort] = useState<SortState>({ key: null, direction: 'asc' });

  const sortedCrashRebound = useMemo(
    () => sortRows(status.crash_rebound ?? [], crashSort),
    [status.crash_rebound, crashSort],
  );
  const sortedTodayScreener = useMemo(
    () => sortRows(status.today_screener ?? [], todaySort),
    [status.today_screener, todaySort],
  );

  const isRunning = status.status === 'running';

  const stopPolling = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const pollStatus = async () => {
    try {
      const response = await fetch('/api/research/small-caps/status');
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || `Server returned status ${response.status}`);
        stopPolling();
        return;
      }
      setStatus(data as ScanStatus);
      if (data?.status === 'running') {
        pollTimer.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
      }
    } catch {
      setError('Lost connection while checking scan status.');
      stopPolling();
    }
  };

  // On load, check whether a scan is already running/done from an earlier
  // visit (single global job on the backend - see research_job.py) rather
  // than assuming a blank slate.
  useEffect(() => {
    pollStatus();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setError('');
    try {
      const response = await fetch('/api/research/small-caps/start', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || `Server returned status ${response.status}`);
        return;
      }
      setStatus(data as ScanStatus);
      stopPolling();
      pollTimer.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
    } catch {
      setError('Failed to reach the research backend.');
    }
  };

  const todayIso = () => new Date().toISOString().slice(0, 10);

  const handleDownloadCrashRebound = () => {
    const csv = rowsToCsv(sortedCrashRebound, CRASH_REBOUND_CSV_COLUMNS);
    downloadCsv(`swiss-small-caps-crash-rebound-${todayIso()}.csv`, csv);
  };

  const handleDownloadTodayScreener = () => {
    const csv = rowsToCsv(sortedTodayScreener, TODAY_SCREENER_CSV_COLUMNS);
    downloadCsv(`swiss-small-caps-today-${todayIso()}.csv`, csv);
  };

  return (
    <main style={{ maxWidth: '1100px', margin: '40px auto', padding: '20px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>🇨🇭 Swiss Small-Cap Research</h2>
          <p style={{ color: '#666' }}>
            Runs two scans against SIX Swiss Exchange, Switzerland-domiciled small caps (excludes foreign listings
            like Bitcoin Group SE or ams-OSRAM). Free-data based (yfinance) - for research, not investment advice.
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

      <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={handleRefresh}
          disabled={isRunning}
          style={{
            padding: '10px 20px',
            backgroundColor: isRunning ? '#888' : '#0070f3',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '15px',
            cursor: isRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {isRunning ? 'Scanning… (1-3 min)' : 'Refresh'}
        </button>
        {status.status === 'done' && status.finished_at && (
          <span style={{ color: '#666', fontSize: '13px' }}>
            Last run: {new Date(status.finished_at).toLocaleString()} · {status.universe_size} tickers scanned
          </span>
        )}
        {status.status === 'idle' && <span style={{ color: '#666', fontSize: '13px' }}>No scan run yet.</span>}
      </div>

      {error && (
        <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '6px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      {status.status === 'error' && status.error && (
        <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '6px' }}>
          <strong>Scan failed:</strong> {status.error}
        </div>
      )}

      <section style={{ marginTop: '28px' }}>
        <h3 style={{ marginBottom: '4px' }}>Crash then rebound (last 3 months)</h3>
        <p style={{ color: '#666', fontSize: '13px', marginTop: 0 }}>
          Stocks with a day down 5%+ followed immediately by a day up 5%+. Shows each day&apos;s own volume (a
          heavy-volume rebound looks more like real buying than an illiquid bounce) and current market cap.
        </p>
        {status.status === 'done' && (status.crash_rebound?.length ?? 0) === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No matches in the last run.</p>
        )}
        {status.status === 'done' && (status.crash_rebound?.length ?? 0) > 0 && (
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
                  <SortableHeader label="Loss date" sortKey="loss_date" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Loss close" sortKey="loss_close" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Loss volume" sortKey="loss_volume" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Drop %" sortKey="drop_pct" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Gain date" sortKey="gain_date" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Gain close" sortKey="gain_close" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Gain volume" sortKey="gain_volume" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Gain %" sortKey="gain_pct" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
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
                    <td style={cellStyle}>{row.loss_date}</td>
                    <td style={cellStyle}>CHF {row.loss_close.toFixed(2)}</td>
                    <td style={cellStyle}>{formatVolume(row.loss_volume)}</td>
                    <td style={{ ...cellStyle, color: '#dc2626' }}>{row.drop_pct.toFixed(2)}%</td>
                    <td style={cellStyle}>{row.gain_date}</td>
                    <td style={cellStyle}>CHF {row.gain_close.toFixed(2)}</td>
                    <td style={cellStyle}>{formatVolume(row.gain_volume)}</td>
                    <td style={{ ...cellStyle, color: '#16a34a' }}>+{row.gain_pct.toFixed(2)}%</td>
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
          Stocks down 5%+ today - no volume filtering, so a big loss on thin volume and one on heavy volume both show
          up. Ordered by volume vs. each stock&apos;s own 3-month average (thinnest first) then by loss size, as a
          reading aid: a stock near the top moved on unusually little trading.
        </p>
        {status.status === 'done' && (status.today_screener?.length ?? 0) === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No matches today.</p>
        )}
        {status.status === 'done' && (status.today_screener?.length ?? 0) > 0 && (
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
