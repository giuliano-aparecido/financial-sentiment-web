'use client';

import { useState } from 'react';

interface AnalysisResult {
  ticker?: string;
  model_architecture?: string;
  predicted_direction?: 'BULLISH' | 'BEARISH' | string;
  confidence?: number;
  reasoning?: string;
  raw_response?: string;
  live_news_retrieved?: string;
}

export default function Home() {
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
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_query: query }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || `Server returned status ${response.status}`);
      }

      const data: AnalysisResult = await response.json();
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
      <h2>📈 Open-Source Financial RAG Reasoning Engine</h2>
      <p style={{ color: '#666' }}>
        Enter any stock query or news prompt. The engine fetches real-time news and runs fine-tuned chain-of-thought reasoning.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
        <textarea
          rows={4}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Will AAPL go up or down based on recent news and quarterly results?"
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
          {loading ? 'Fetching RAG News & Reasoning...' : 'Analyze Stock'}
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

          <div style={{ marginBottom: '12px' }}>
            <strong>Architecture:</strong> <code>{result.model_architecture}</code>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <strong>Predicted Direction:</strong>{' '}
            <span
              style={{
                fontWeight: 'bold',
                color: result.predicted_direction === 'BULLISH' ? 'green' : result.predicted_direction === 'BEARISH' ? 'red' : 'gray',
              }}
            >
              {result.predicted_direction}
            </span>
          </div>

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

          <div>
            <strong>Retrieved RAG News Context:</strong>
            <pre style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '13px', overflowX: 'auto' }}>
              {result.live_news_retrieved}
            </pre>
          </div>
        </div>
      )}
    </main>
  );
}
