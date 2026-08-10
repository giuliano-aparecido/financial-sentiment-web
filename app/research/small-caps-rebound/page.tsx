'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';

interface CrashReboundRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: number | null;
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

const cellStyle: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #eee', fontSize: '13px' };
const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 'bold',
  color: '#666',
  textAlign: 'left',
  borderBottom: '2px solid #ddd',
  whiteSpace: 'nowrap',
};

export default function SmallCapsReboundPage() {
  const { data: session } = useSession();
  const [status, setStatus] = useState<ScanStatus>({ status: 'idle' });
  const [error, setError] = useState('');
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          Stocks with a day down 5%+ followed immediately by a day up 5%+. Includes volume vs. each stock&apos;s own
          3-month average (a heavy-volume rebound looks more like real buying than an illiquid bounce) and any
          researched news explaining the move.
        </p>
        {status.status === 'done' && (status.crash_rebound?.length ?? 0) === 0 && (
          <p style={{ color: '#666', fontSize: '13px' }}>No matches in the last run.</p>
        )}
        {status.status === 'done' && (status.crash_rebound?.length ?? 0) > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>Ticker</th>
                  <th style={headerCellStyle}>Name</th>
                  <th style={headerCellStyle}>Sector</th>
                  <th style={headerCellStyle}>Loss day</th>
                  <th style={headerCellStyle}>Drop %</th>
                  <th style={headerCellStyle}>Gain day</th>
                  <th style={headerCellStyle}>Gain %</th>
                  <th style={headerCellStyle}>Gain vol. vs 3mo avg</th>
                  <th style={headerCellStyle}>News</th>
                </tr>
              </thead>
              <tbody>
                {status.crash_rebound!.map((row, i) => (
                  <tr key={`${row.ticker}-${row.loss_date}-${i}`}>
                    <td style={cellStyle}>
                      <strong>{row.ticker}</strong>
                    </td>
                    <td style={cellStyle}>{row.name}</td>
                    <td style={cellStyle}>{row.sector ?? 'N/A'}</td>
                    <td style={cellStyle}>
                      {row.loss_date}
                      <br />
                      CHF {row.loss_close.toFixed(2)}
                    </td>
                    <td style={{ ...cellStyle, color: '#dc2626' }}>{row.drop_pct.toFixed(2)}%</td>
                    <td style={cellStyle}>
                      {row.gain_date}
                      <br />
                      CHF {row.gain_close.toFixed(2)}
                    </td>
                    <td style={{ ...cellStyle, color: '#16a34a' }}>+{row.gain_pct.toFixed(2)}%</td>
                    <td style={cellStyle}>{formatVolumeRatio(row.gain_volume_vs_3mo_avg)}</td>
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
                  <th style={headerCellStyle}>Ticker</th>
                  <th style={headerCellStyle}>Name</th>
                  <th style={headerCellStyle}>Sector</th>
                  <th style={headerCellStyle}>Market cap</th>
                  <th style={headerCellStyle}>Price</th>
                  <th style={headerCellStyle}>Change %</th>
                  <th style={headerCellStyle}>Volume today</th>
                  <th style={headerCellStyle}>Vol. vs 3mo avg</th>
                </tr>
              </thead>
              <tbody>
                {status.today_screener!.map((row, i) => (
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
