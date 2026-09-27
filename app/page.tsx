'use client';

import { Suspense, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { signOutToLogin } from '@/lib/signOutToLogin';

interface AnalysisResult {
  ticker?: string;
  ticker_was_explicit?: boolean;
  model_architecture?: string;
  recommendation?: 'BUY' | 'SELL' | 'HOLD' | string;
  news_reaction?: string;
  news_reaction_fallback?: boolean;
  confidence?: number;
  reasoning?: string;
  answer?: string;
  raw_response?: string;
  live_news_retrieved?: string;
  market_data?: string;
  valuation?: string;
  earnings?: string;
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const model = searchParams.get('model');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState('');

  const handleAnalyze = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const data = await fetchAnalysis(query, model);
      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze query. Please check your backend status.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: '800px', margin: '40px auto', padding: '20px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>📈 Open-Source Financial Sentiment Reasoning Engine</h2>
          <p style={{ color: '#666' }}>
            Enter any stock query or news prompt. The engine fetches real-time news and runs fine-tuned chain-of-thought reasoning.
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
          Tip: wrap the ticker in a cashtag, e.g. <code>$AAPL</code>, so it&apos;s picked up reliably.
        </p>
        <textarea
          rows={4}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Will $AAPL go up or down based on recent news and quarterly results?"
          style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '16px' }}
        />
        <button
          onClick={handleAnalyze}
          disabled={loading || !query.trim()}
          style={{
            padding: '12px 24px',
            backgroundColor: loading ? '#888' : '#0070f3',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Fetching News & Reasoning...' : 'Analyze Stock'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: '20px', padding: '12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '6px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '28px', padding: '20px', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: '#f9fafb' }}>
          <h3>Analysis Results {result.ticker ? `(${result.ticker})` : ''}</h3>

          {result.ticker_was_explicit === false && (
            <div
              style={{
                marginBottom: '16px',
                padding: '12px',
                backgroundColor: '#fef9c3',
                border: '1px solid #fde047',
                borderRadius: '6px',
                color: '#854d0e',
                fontSize: '14px',
              }}
            >
              <strong>No specific ticker found in your question.</strong> Showing analysis for{' '}
              <strong>{result.ticker || 'AAPL'}</strong> (default) instead. Try naming a company or wrapping the
              ticker in a cashtag, e.g. <code>$AAPL</code>, for an analysis of the stock you meant.
            </div>
          )}

          {hasData(result.answer) && (
            <div
              style={{
                marginBottom: '16px',
                padding: '14px',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '6px',
                fontSize: '16px',
              }}
            >
              {result.answer}
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <strong>Architecture:</strong> <code>{result.model_architecture}</code>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <strong>Recommendation:</strong>{' '}
            {result.recommendation ? (
              <span
                style={{
                  fontWeight: 'bold',
                  color: result.recommendation === 'BUY' ? 'green' : result.recommendation === 'SELL' ? 'red' : 'gray',
                }}
              >
                {result.recommendation}
              </span>
            ) : (
              <span style={{ color: '#666', fontStyle: 'italic' }}>
                Not available — the model&apos;s response couldn&apos;t be parsed. See the reasoning below for its raw output.
              </span>
            )}
          </div>

          {result.news_reaction && (
            <div style={{ marginBottom: '12px' }}>
              <strong>News Reaction:</strong> <code>{result.news_reaction}</code>
              {result.news_reaction_fallback && (
                <span style={{ color: '#666', fontSize: '13px' }}> (model output unparseable — defaulted to neutral)</span>
              )}
            </div>
          )}

          {typeof result.confidence === 'number' && (
            <div style={{ marginBottom: '12px' }}>
              <strong>Confidence Score:</strong> {(result.confidence * 100).toFixed(1)}%
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <strong>Detailed Reasoning:</strong>
            <p style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '4px', border: '1px solid #ddd' }}>
              {result.reasoning || result.raw_response}
            </p>
          </div>

          {(hasData(result.market_data) || hasData(result.valuation) || hasData(result.earnings)) && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '12px',
                marginBottom: '16px',
              }}
            >
              <DataCard title="Market Data" content={result.market_data} />
              <DataCard title="Valuation" content={result.valuation} />
              <DataCard title="Recent Earnings" content={result.earnings} />
            </div>
          )}

          <div>
            <strong>Retrieved News Context:</strong>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', backgroundColor: '#fff', padding: '12px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '13px', overflowX: 'auto' }}>
              {result.live_news_retrieved}
            </pre>
          </div>
        </div>
      )}
    </main>
  );
}

function hasData(block: string | undefined): block is string {
  return typeof block === 'string' && block.trim().length > 0 && block !== 'Data unavailable.';
}

function DataCard({ title, content }: { title: string; content?: string }) {
  if (!hasData(content)) return null;

  return (
    <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '4px', border: '1px solid #ddd' }}>
      <strong style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: '#666' }}>{title}</strong>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: '13px' }}>{content}</pre>
    </div>
  );
}

async function fetchAnalysis(query: string, model: string | null): Promise<AnalysisResult> {
  const url = model ? `/api/analyze?model=${encodeURIComponent(model)}` : '/api/analyze';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_query: query }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error || `Server returned status ${response.status}`);
  }

  return response.json();
}
