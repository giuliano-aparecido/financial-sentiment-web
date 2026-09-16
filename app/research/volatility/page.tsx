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
  type CrashReboundRow,
  type TodayScreenerRow,
  type VolatilityIndicatorRow,
} from '@/lib/volatilityScans';

// NOTE: only the rebound table's ADTV/Gain % columns carry a `title`
// tooltip below - that asymmetry is intentional (preserved from before
// this refactor), not a bug to "fix" by adding tooltips to the other
// two tables as a drive-by cleanup.
const TODAY_SCREENER_COLUMNS: VolatilityColumn<TodayScreenerRow>[] = [
  { key: 'ticker', label: 'Ticker', renderCell: (row) => <TickerLink ticker={row.ticker} /> },
  { key: 'name', label: 'Name', renderCell: (row) => row.name },
  { key: 'sector', label: 'Sector', renderCell: (row) => row.sector ?? 'N/A' },
  { key: 'market_cap', label: 'Market cap', renderCell: (row) => formatMarketCap(row.market_cap) },
  { key: 'price', label: 'Price', renderCell: (row) => (row.price != null ? `CHF ${row.price.toFixed(2)}` : 'N/A') },
  {
    key: 'change_pct',
    label: 'Change %',
    cellStyle: (row) => ({
      color: row.change_pct == null ? '#666' : row.change_pct > 0 ? '#16a34a' : row.change_pct < 0 ? '#dc2626' : '#666',
    }),
    renderCell: (row) => formatPct(row.change_pct, true),
  },
  { key: 'volume_today', label: 'Volume today', renderCell: (row) => formatVolume(row.volume_today) },
];

const VOLATILITY_INDICATOR_COLUMNS: VolatilityColumn<VolatilityIndicatorRow>[] = [
  { key: 'ticker', label: 'Ticker', renderCell: (row) => <TickerLink ticker={row.ticker} /> },
  { key: 'name', label: 'Name', renderCell: (row) => row.name },
  { key: 'sector', label: 'Sector', renderCell: (row) => row.sector ?? 'N/A' },
  { key: 'market_cap', label: 'Market cap', renderCell: (row) => formatMarketCap(row.market_cap) },
  { key: 'loss_days', label: 'Loss days', cellStyle: () => ({ color: '#dc2626' }), renderCell: (row) => row.loss_days },
  { key: 'gain_days', label: 'Gain days', cellStyle: () => ({ color: '#16a34a' }), renderCell: (row) => row.gain_days },
  { key: 'total_days', label: 'Total days', renderCell: (row) => <strong>{row.total_days}</strong> },
];

const CRASH_REBOUND_COLUMNS: VolatilityColumn<CrashReboundRow>[] = [
  { key: 'ticker', label: 'Ticker', renderCell: (row) => <TickerLink ticker={row.ticker} /> },
  { key: 'name', label: 'Name', renderCell: (row) => row.name },
  { key: 'sector', label: 'Sector', renderCell: (row) => row.sector ?? 'N/A' },
  { key: 'market_cap', label: 'Market cap', renderCell: (row) => formatMarketCap(row.market_cap) },
  {
    key: 'avg_volume_10d',
    label: 'ADTV',
    title: 'Average daily trading volume over the last 10 days.',
    renderCell: (row) => formatVolume(row.avg_volume_10d),
  },
  { key: 'loss_date', label: 'Loss date', renderCell: (row) => row.loss_date },
  { key: 'loss_close', label: 'Loss close', renderCell: (row) => formatPrice(row.loss_close) },
  { key: 'drop_pct', label: 'Drop %', cellStyle: () => ({ color: '#dc2626' }), renderCell: (row) => formatPct(row.drop_pct) },
  { key: 'days_to_rebound', label: 'Days to rebound', renderCell: (row) => row.days_to_rebound },
  { key: 'gain_date', label: 'Gain date', renderCell: (row) => row.gain_date },
  { key: 'gain_close', label: 'Gain close', renderCell: (row) => formatPrice(row.gain_close) },
  {
    key: 'gain_pct',
    label: 'Gain %',
    title:
      "Cumulative gain from the crash-day close to the close on the rebound day (see Days to rebound) - not that day's own daily move.",
    cellStyle: () => ({ color: '#16a34a' }),
    renderCell: (row) => formatPct(row.gain_pct, true),
  },
];

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
            <VolatilitySortableTable
              columns={TODAY_SCREENER_COLUMNS}
              rows={sortedTodayScreener}
              sort={todaySort}
              onSort={(key) => setTodaySort(toggleSort(todaySort, key))}
              rowKey={(row, i) => `${row.ticker}-${i}`}
            />
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
            <VolatilitySortableTable
              columns={VOLATILITY_INDICATOR_COLUMNS}
              rows={sortedVolatilityIndicator}
              sort={indicatorSort}
              onSort={(key) => setIndicatorSort(toggleSort(indicatorSort, key))}
              rowKey={(row, i) => `${row.ticker}-${i}`}
            />
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
            <VolatilitySortableTable
              columns={CRASH_REBOUND_COLUMNS}
              rows={sortedCrashRebound}
              sort={crashSort}
              onSort={(key) => setCrashSort(toggleSort(crashSort, key))}
              rowKey={(row, i) => `${row.ticker}-${row.loss_date}-${i}`}
            />
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

interface VolatilityColumn<T> {
  key: Extract<keyof T, string>;
  label: string;
  // Optional header tooltip - only ADTV and Gain % on the rebound table
  // use this today (see the NOTE above TODAY_SCREENER_COLUMNS).
  title?: string;
  // Per-row style override (e.g. red/green for gains vs. losses),
  // merged on top of the shared cellStyle base.
  cellStyle?: (row: T) => React.CSSProperties;
  renderCell: (row: T) => React.ReactNode;
}

function VolatilitySortableTable<T>({
  columns,
  rows,
  sort,
  onSort,
  rowKey,
}: {
  columns: VolatilityColumn<T>[];
  rows: T[];
  sort: SortState;
  onSort: (key: string) => void;
  rowKey: (row: T, index: number) => string;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <SortableHeader
                key={column.key}
                label={column.label}
                sortKey={column.key}
                sort={sort}
                onSort={onSort}
                title={column.title}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)}>
              {columns.map((column) => (
                <td key={column.key} style={column.cellStyle ? { ...cellStyle, ...column.cellStyle(row) } : cellStyle}>
                  {column.renderCell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
