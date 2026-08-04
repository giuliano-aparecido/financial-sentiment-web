import { NextRequest, NextResponse } from 'next/server';

// The API's own HF inference call can take up to 45s; give it headroom
// before this route's own budget (below) or a hung upstream (e.g. a stale
// Colab/ngrok tunnel) cuts it off with an opaque error.
export const maxDuration = 60;

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_API_KEY = process.env.RAG_API_KEY;

export async function POST(request: NextRequest) {
  if (!RAG_API_URL || !RAG_API_KEY) {
    return NextResponse.json({ error: 'Server is not configured.' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${RAG_API_URL}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': RAG_API_KEY,
      },
      body: JSON.stringify(body),
      // Slightly above the API's own 45s inference timeout, so a hung
      // upstream (e.g. a stale Colab/ngrok tunnel) fails fast with a clear
      // message instead of the request sitting until Vercel's own limit.
      signal: AbortSignal.timeout(50_000),
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const upstreamError = data as { error?: string; detail?: string } | null;
      return NextResponse.json(
        { error: upstreamError?.error || upstreamError?.detail || `Upstream returned status ${upstream.status}` },
        { status: upstream.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'The analysis backend took too long to respond. It may be waking up from idle - try again shortly.' },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: 'Failed to reach the analysis backend.' }, { status: 502 });
  }
}
