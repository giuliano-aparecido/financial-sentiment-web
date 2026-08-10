# Financial RAG Reasoning Engine — Frontend

A single-page Next.js UI for a financial-news sentiment/reasoning demo:
enter a stock query (optionally with a `$TICKER` cashtag), and it proxies
to a separate FastAPI backend —
[`financial-sentiment-api`](https://github.com/GiulianoAparecido/financial-sentiment-api)
— which fetches live news and runs a fine-tuned LLM's chain-of-thought
reasoning against it.

Built as a portfolio/curriculum project — hardened for the practice of
doing it properly, not because it needs to scale or handle real traffic.

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
  research/small-caps-rebound/page.tsx   Swiss small-cap research page -
                                Refresh button, two result tables (see
                                below)
  login/page.tsx               Sign-in page (Google OAuth in production)
  api/analyze/route.ts          Server-side proxy to the RAG API - the
                                only place RAG_API_KEY is ever read, so
                                it never reaches the browser bundle
  api/research/small-caps/start/route.ts    Kicks off the small-cap scan
                                (proxies to the RAG API's background-job
                                endpoint - see financial-sentiment-api's
                                app/services/research_job.py)
  api/research/small-caps/status/route.ts   Polled by the page while a
                                scan runs
  api/auth/[...nextauth]/route.ts   NextAuth handler
components/SessionProvider.tsx  NextAuth session context + idle-logout
lib/auth.ts                     NextAuth config (allowlist, dev bypass)
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

**Swiss small-cap research page** (`/research/small-caps-rebound`): runs
two Python scans on the RAG API backend (which already runs yfinance in
production - this Next.js app is deployed on Vercel serverless functions,
which can't run a 1-3 minute, ~150+ network-call Python script at all, no
Python runtime and execution time caps far below that). Since a scan takes
too long for a single request/response, the start route kicks off a
background job on the backend and returns immediately; the page polls the
status route every 5s until it's done. Reuses `RAG_API_URL`/`RAG_API_KEY` -
same backend, same shared secret, no separate env vars needed.

`page.tsx`'s `AnalysisResult` type includes optional `answer`/`market_data`/
`valuation`/`earnings` fields (the "analyst pipeline" expansion - see the
sibling `financial-sentiment-model`/`financial-sentiment-api` repos).
Each renders only when present and not exactly `"Data unavailable."`, so
the UI degrades gracefully both against the current API (which doesn't
send these yet) and against a future one where only some of them fetched
successfully.

Every request to the RAG API goes through `app/api/analyze/route.ts`,
never directly from the browser — that's the one place `RAG_API_URL`/
`RAG_API_KEY` are read, so the shared secret never reaches client-side
JS. The route also re-checks the session server-side (defense in depth:
`proxy.ts`'s matcher is what actually gates this today, but a careless
regex edit there shouldn't be able to silently expose an endpoint that
spends paid inference quota), validates/caps the request body, and
applies a best-effort per-user rate limit (`lib/rateLimit.ts` — in-memory,
per-process, not a real security boundary on Vercel's serverless model;
the API's own global rate limit is the actual backstop).

## Auth

Google OAuth via NextAuth, gated by an email allowlist
(`ALLOWED_EMAILS`) — this app has no database, so the allowlist lives
entirely in `lib/auth.ts`'s env var, fails closed (unset/empty denies
everyone). In development (`NODE_ENV=development`), a `CredentialsProvider`
auto-signs in as a fixed `dev@local.test` user and `proxy.ts` skips its
own check entirely — no real Google credentials needed locally.

**Idle logout**: `components/SessionProvider.tsx` signs a user out after
15 minutes of no activity, persisting a last-activity timestamp to
`localStorage` rather than relying on a plain in-memory timer — a naive
`setTimeout`-only version doesn't actually work on mobile, where a
backgrounded tab getting discarded and reloaded resets an in-memory timer
to a fresh 15 minutes with no memory of how long the user was actually
away. See the component's own comments for the full explanation.

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
`CLAUDE.md` one directory up, outside this repo, alongside its sibling
repos) applies: **branch + PR, never push directly to `main`.**
