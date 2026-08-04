'use client';

import { Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'sans-serif',
        padding: '20px',
      }}
    >
      <div style={{ maxWidth: '360px', width: '100%', textAlign: 'center' }}>
        <h2>📈 Financial RAG Reasoning Engine</h2>
        <p style={{ color: '#666', marginBottom: '24px' }}>Sign in with Google to continue</p>

        {error && (
          <div
            style={{
              marginBottom: '20px',
              padding: '12px',
              backgroundColor: '#fee2e2',
              color: '#dc2626',
              borderRadius: '6px',
              fontSize: '14px',
            }}
          >
            {error === 'AccessDenied' && 'Access denied. Only authorized users can access this app.'}
            {error === 'SessionExpired' && 'You were signed out after a period of inactivity. Please sign in again.'}
            {error !== 'AccessDenied' && error !== 'SessionExpired' && `Sign in error: ${error}`}
          </div>
        )}

        <button
          onClick={() => signIn('google', { callbackUrl: '/' })}
          style={{
            width: '100%',
            padding: '12px 24px',
            backgroundColor: '#0070f3',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer',
          }}
        >
          Sign in with Google
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
      <LoginContent />
    </Suspense>
  );
}
