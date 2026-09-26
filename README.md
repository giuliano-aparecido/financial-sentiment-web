# Financial RAG Reasoning Engine — Frontend

A single-page Next.js UI for a financial-news sentiment/reasoning demo:
enter a stock query (optionally with a `$TICKER` cashtag), and it proxies
to a separate FastAPI backend —
[`financial-sentiment-api`](https://github.com/GiulianoAparecido/financial-sentiment-api)
— which fetches live news and runs a fine-tuned LLM's chain-of-thought
reasoning against it.

## Stack

- **Next.js 16** + **React 19** + **TypeScript**
- **NextAuth.js** — Google OAuth in production (email allowlist), a fixed
  auto-signin dev user locally
- Plain inline styles (`style={{}}`), no CSS framework — this is a small
  enough app that a stylesheet/Tailwind wasn't worth the setup

## Architecture

```
app/
  page.tsx                    The main page: query box, results
  research/volatility/page.tsx  Swiss volatility research page - three
                                tables (indicator/rebound/today), each
                                with its own Refresh button (see below)
  login/page.tsx               Sign-in page (Google OAuth in production)
  api/analyze/route.ts          Server-side proxy to the RAG API
  api/research/volatility/indicator/{route,start,status,retryOnlyFailed}.ts
                                Volatility-indicator table: route.ts reads
                                the last persisted scan, start/status
                                drive a manual Refresh, retryOnlyFailed
                                re-fetches just the tickers that failed
  api/research/volatility/rebound/{route,start,status,retryOnlyFailed}.ts
                                Crash-rebound table, same route shape
  api/research/volatility/today/{start,status}.ts
                                Big-loss-today table - always live/
                                on-demand, no separate persisted-read route
  api/auth/[...nextauth]/route.ts   NextAuth handler
components/SessionProvider.tsx  NextAuth session context + idle-logout
lib/auth.ts                     NextAuth config (allowlist, dev bypass)
lib/backendProxy.ts             Shared session/allowlist/rate-limit guard
                                and upstream-fetch/error-mapping helpers
                                used by every route above - the only place
                                RAG_API_KEY is ever read, so it never
                                reaches the browser bundle
lib/backendAwareFetch.ts        Shared cold-start retry logic for the
                                volatility page's polling/refresh flows
lib/volatilityScans.ts          Row/result/status types, the three
                                per-table scan hooks (fetch/poll/
                                refresh/retry), and CSV export helpers
                                for the volatility page
lib/rateLimit.ts                Best-effort per-user rate limit on the proxy
                                routes - parameterized (window/max) so the
                                research routes can use a stricter/looser
                                budget than /api/analyze's, under a
                                differently-prefixed key so the buckets
                                don't collide
proxy.ts                        Page-level route protection (was
                                middleware.ts before the Next.js 16 upgrade
                                renamed the convention)
```

**Swiss volatility research page** (`/research/volatility`): runs Python
scans on the RAG API backend, since Vercel's serverless functions can't
run a multi-minute, many-network-call Python script. The indicator/rebound
tables show the backend's last persisted scan; Refresh starts a new
background job and the page polls its status every 5s until done.

`page.tsx`'s `AnalysisResult` type includes optional `answer`/`market_data`/
`valuation`/`earnings` fields (the "analyst pipeline" expansion — see the
sibling `financial-sentiment-model`/`financial-sentiment-api` repos), each
rendered only when present so the UI degrades gracefully against an API
that hasn't sent them yet.

A query goes through `app/api/analyze/route.ts`, never directly from the
browser to the RAG API — `lib/backendProxy.ts` is the only place
`RAG_API_URL`/`RAG_API_KEY` are read, so the shared secret never reaches
client-side JS. The route also re-checks the session server-side,
validates/caps the request body, and applies a best-effort per-user rate
limit.

## Auth

Google OAuth via NextAuth, gated by an email allowlist (`ALLOWED_EMAILS`)
— fails closed (unset/empty denies everyone). In development, a
`CredentialsProvider` auto-signs in as a fixed dev user, no real Google
credentials needed locally.

**Idle logout**: signs a user out after 15 minutes of no activity,
persisting the last-activity timestamp to `localStorage` rather than a
plain in-memory timer — a `setTimeout`-only version doesn't survive a
backgrounded mobile tab getting discarded and reloaded.

## Local development

```bash
npm install
cp .env.local.example .env.local   # RAG_API_URL/RAG_API_KEY at minimum;
                                    # auth vars not needed in dev
npm run dev
```

Requires [`financial-sentiment-api`](https://github.com/GiulianoAparecido/financial-sentiment-api)
running (or deployed) at the URL configured in `RAG_API_URL`.

## Tests / build

```bash
npx vitest run    # route-handler tests (analyze/research proxy error
                   # mapping, rate-limit key isolation)
npx tsc --noEmit
npm run build      # also catches Edge Runtime issues in proxy.ts that
                   # tsc alone won't; requires NEXTAUTH_SECRET set (any
                   # value locally) since lib/auth.ts refuses to even
                   # evaluate without one outside development
```

## Deployment

Vercel. Security headers (CSP, frame-ancestors, etc.) are set in
`next.config.js` — note the CSP's `script-src` allows `'unsafe-eval'`
only when `NODE_ENV=development` (React dev tooling/Turbopack HMR need
it; production Next.js never uses `eval()` at all, so the deployed CSP
stays strict).

## Contributing

No dedicated `CONTRIBUTING.md` yet, but the fleet-wide default (see the
`AGENTS.md` one directory up, outside this repo, alongside its sibling
repos) applies: **branch + PR, never push directly to `main`.**

## License

Dual-licensed under either of

- [MIT license](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

at your option.
