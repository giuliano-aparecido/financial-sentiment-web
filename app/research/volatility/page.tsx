'use client';

import { useSession } from 'next-auth/react';
import { signOutToLogin } from '@/lib/signOutToLogin';
import {
  THRESHOLD_OPTIONS,
  useReboundScan,
  useTodayScan,
  useIndicatorScan,
  toggleSort,
  type SortState,
} from '@/lib/volatilityScans';

export default function VolatilityResearchPage() {
  const { data: session } = useSession();

  const {
    result: reboundResult,
    loading: reboundLoading,
    error: reboundError,
    backendStarting: reboundBackendStarting,
    triggerDropped: reboundTriggerDropped,
    sort: crashSort,
    setSort: setCrashSort,
    sortedRows: sortedCrashRebound,
    handleRefresh: handleReboundRefresh,
    handleRetry: handleReboundRetry,
    handleDownload: handleDownloadCrashRebound,
  } = useReboundScan();

  const {
    status: todayStatus,
    error: todayError,
    backendStarting: todayBackendStarting,
    triggerDropped: todayTriggerDropped,
    isRunning: isTodayRunning,
    sort: todaySort,
    setSort: setTodaySort,
    sortedRows: sortedTodayScreener,
    handleRefresh: handleTodayRefresh,
    handleDownload: handleDownloadTodayScreener,
  } = useTodayScan();

  const {
    result: indicatorResult,
    loading: indicatorLoading,
    error: indicatorError,
    backendStarting: indicatorBackendStarting,
    triggerDropped: indicatorTriggerDropped,
    threshold: indicatorThreshold,
    setThreshold: setIndicatorThreshold,
    sort: indicatorSort,
    setSort: setIndicatorSort,
    sortedRows: sortedVolatilityIndicator,
    handleRefresh: handleIndicatorRefresh,
    handleRetry: handleIndicatorRetry,
    handleDownload: handleDownloadVolatilityIndicator,
  } = useIndicatorScan();

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
                    <td style={{ ...cellStyle, color: row.change_pct == null ? '#666' : row.change_pct > 0 ? '#16a34a' : row.change_pct < 0 ? '#dc2626' : '#666' }}>
                      {formatPct(row.change_pct, true)}
                    </td>
                    <td style={cellStyle}>{formatVolume(row.volume_today)}</td>
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

const cellStyle: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #eee', fontSize: '13px' };
const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 'bold',
  color: '#666',
  textAlign: 'left',
  borderBottom: '2px solid #ddd',
  whiteSpace: 'nowrap',
};

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
// surfacing it as a failure - see BACKEND_STARTUP_MAX_ATTEMPTS in
// lib/volatilityScans.ts.
function BackendStartingNotice() {
  return (
    <InfoNotice>
      Waiting for the research backend to start up - this can take up to a minute after it&apos;s been idle.
      Retrying automatically…
    </InfoNotice>
  );
}

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
