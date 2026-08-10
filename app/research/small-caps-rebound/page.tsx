'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';

interface CrashReboundRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  dividend_yield: number | null;
  ex_dividend_date: string | null;
  beta: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  loss_date: string;
  loss_close: number;
  loss_volume: number | null;
  loss_volume_vs_3mo_avg: number | null;
  drop_pct: number;
  gain_date: string;
  gain_close: number;
  gain_volume: number | null;
  gain_volume_vs_3mo_avg: number | null;
  gain_pct: number;
  news_headline: string | null;
  news_source: string | null;
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
  volume_vs_3mo_avg: number | null;
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

function formatVolumeRatio(value: number | null): string {
  return value == null ? 'N/A' : `${value.toFixed(2)}x`;
}

function formatNumber(value: number | null, decimals = 2): string {
  return value == null ? 'N/A' : value.toFixed(decimals);
}

function formatPercent(value: number | null, decimals = 2): string {
  return value == null ? 'N/A' : `${value.toFixed(decimals)}%`;
}

function formatVolume(value: number | null): string {
  return value == null ? 'N/A' : value.toLocaleString();
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
              onClick={() => signOut({ callbackUrl: '/login' })}
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
          Stocks with a day down 5%+ followed immediately by a day up 5%+. Shows each day&apos;s own volume (raw and
          vs. each stock&apos;s 3-month average - a heavy-volume rebound looks more like real buying than an illiquid
          bounce), current company data (market cap, trailing/forward P/E, dividend yield, ex-dividend date, beta,
          52-week range), and any researched news explaining the move.
        </p>
        {status.status === 'done' && (status.crash_rebound?.length ?? 0) === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No matches in the last run.</p>
        )}
        {status.status === 'done' && (status.crash_rebound?.length ?? 0) > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
              <thead>
                <tr>
                  <SortableHeader label="Ticker" sortKey="ticker" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Name" sortKey="name" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Sector" sortKey="sector" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Market cap" sortKey="market_cap" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="P/E (trailing)" sortKey="trailing_pe" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="P/E (fwd)" sortKey="forward_pe" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Div. yield" sortKey="dividend_yield" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Ex-div date" sortKey="ex_dividend_date" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Beta" sortKey="beta" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="52W high" sortKey="fifty_two_week_high" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="52W low" sortKey="fifty_two_week_low" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Loss date" sortKey="loss_date" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Loss close" sortKey="loss_close" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Loss volume" sortKey="loss_volume" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader
                    label="Loss vol. vs 3mo avg"
                    sortKey="loss_volume_vs_3mo_avg"
                    sort={crashSort}
                    onSort={(k) => setCrashSort(toggleSort(crashSort, k))}
                  />
                  <SortableHeader label="Drop %" sortKey="drop_pct" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Gain date" sortKey="gain_date" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Gain close" sortKey="gain_close" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="Gain volume" sortKey="gain_volume" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader
                    label="Gain vol. vs 3mo avg"
                    sortKey="gain_volume_vs_3mo_avg"
                    sort={crashSort}
                    onSort={(k) => setCrashSort(toggleSort(crashSort, k))}
                  />
                  <SortableHeader label="Gain %" sortKey="gain_pct" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
                  <SortableHeader label="News" sortKey="news_headline" sort={crashSort} onSort={(k) => setCrashSort(toggleSort(crashSort, k))} />
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
                    <td style={cellStyle}>{formatNumber(row.trailing_pe)}</td>
                    <td style={cellStyle}>{formatNumber(row.forward_pe)}</td>
                    <td style={cellStyle}>{formatPercent(row.dividend_yield)}</td>
                    <td style={cellStyle}>{row.ex_dividend_date ?? 'N/A'}</td>
                    <td style={cellStyle}>{formatNumber(row.beta)}</td>
                    <td style={cellStyle}>{row.fifty_two_week_high != null ? `CHF ${row.fifty_two_week_high.toFixed(2)}` : 'N/A'}</td>
                    <td style={cellStyle}>{row.fifty_two_week_low != null ? `CHF ${row.fifty_two_week_low.toFixed(2)}` : 'N/A'}</td>
                    <td style={cellStyle}>{row.loss_date}</td>
                    <td style={cellStyle}>CHF {row.loss_close.toFixed(2)}</td>
                    <td style={cellStyle}>{formatVolume(row.loss_volume)}</td>
                    <td style={cellStyle}>{formatVolumeRatio(row.loss_volume_vs_3mo_avg)}</td>
                    <td style={{ ...cellStyle, color: '#dc2626' }}>{row.drop_pct.toFixed(2)}%</td>
                    <td style={cellStyle}>{row.gain_date}</td>
                    <td style={cellStyle}>CHF {row.gain_close.toFixed(2)}</td>
                    <td style={cellStyle}>{formatVolume(row.gain_volume)}</td>
                    <td style={cellStyle}>{formatVolumeRatio(row.gain_volume_vs_3mo_avg)}</td>
                    <td style={{ ...cellStyle, color: '#16a34a' }}>+{row.gain_pct.toFixed(2)}%</td>
                    <td style={{ ...cellStyle, maxWidth: '320px', whiteSpace: 'normal' }}>
                      {row.news_headline ? (
                        row.news_source ? (
                          <a href={row.news_source} target="_blank" rel="noopener noreferrer">
                            {row.news_headline}
                          </a>
                        ) : (
                          row.news_headline
                        )
                      ) : (
                        <span style={{ color: '#999' }}>Not researched</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ marginTop: '32px' }}>
        <h3 style={{ marginBottom: '4px' }}>All small caps (today)</h3>
        <p style={{ color: '#666', fontSize: '13px', marginTop: 0 }}>
          Every scanned small cap&apos;s today numbers - no loss or volume filtering, this is the full universe.
          Ordered by volume vs. each stock&apos;s own 3-month average (thinnest first) then by move size, purely as a
          reading aid: a stock near the top is trading unusually thin today, whether it&apos;s up, down, or flat.
        </p>
        {status.status === 'done' && (status.today_screener?.length ?? 0) === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No live quotes available yet today.</p>
        )}
        {status.status === 'done' && (status.today_screener?.length ?? 0) > 0 && (
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
                  <SortableHeader
                    label="Vol. vs 3mo avg"
                    sortKey="volume_vs_3mo_avg"
                    sort={todaySort}
                    onSort={(k) => setTodaySort(toggleSort(todaySort, k))}
                  />
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
                    <td style={cellStyle}>{formatVolumeRatio(row.volume_vs_3mo_avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
