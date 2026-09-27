# Project Overview

## What this is

A single-page Next.js UI for a financial-news sentiment/reasoning demo:
enter a stock query (optionally with a `$TICKER` cashtag), and it proxies
to a separate FastAPI backend —
[`financial-sentiment-api`](https://github.com/giuliano-aparecido/financial-sentiment-api)
— which fetches live news and runs a fine-tuned LLM's chain-of-thought
reasoning against it.

The Swiss volatility research pages that used to live here moved to
[`financial-research-web`](https://github.com/giuliano-aparecido/financial-research-web)
(private) / [`financial-research-api`](https://github.com/giuliano-aparecido/financial-research-api),
so this repo is only the AI-reasoning feature.

## Architecture

```
app/
  page.tsx                  The main query page
  login/page.tsx              Sign-in page
  api/
    analyze/route.ts          Thin proxy to financial-sentiment-api's
                             /api/analyze - the only place a query
                             actually leaves the browser
    auth/[...nextauth]/route.ts   NextAuth handler
lib/
  auth.ts                    NextAuthOptions + isAllowedEmail() - see
                             "Auth" below
  backendProxy.ts             Shared fetch-and-forward helper: session
                             check, allowlist check, rate limit, then
                             forwards to financial-sentiment-api with
                             the shared X-API-Key header
  rateLimit.ts                 Best-effort per-user in-memory rate limit
  signOutToLogin.ts            Shared sign-out-and-redirect helper
components/
  SessionProvider.tsx          Wraps next-auth's SessionProvider; owns
                             the idle-logout timer (see below)
proxy.ts                     NextAuth middleware gating every route
                             except /login and /api/auth/*
```

`page.tsx`'s `AnalysisResult` type includes optional `answer`/`market_data`/
`valuation`/`earnings` fields (the "analyst pipeline" expansion - see the
sibling `financial-sentiment-model`/`financial-sentiment-api` repos), each
rendered only when present so the UI degrades gracefully against an API
that hasn't sent them yet.

## Key design decisions

- **The shared backend secret never reaches the browser.** `RAG_API_URL`/
  `RAG_API_KEY` are read only in `lib/backendProxy.ts`, a server-side
  module. A query goes browser -> `app/api/analyze/route.ts` -> financial-
  sentiment-api, never directly from the browser to the API.
- **The analyze route re-checks the session server-side and applies a
  rate limit**, rather than trusting the client - `authorizeBackendRequest`
  (`lib/backendProxy.ts`) is a single guard shared by every proxied route,
  so this enforcement can't be forgotten on a new one.
- **`fetchUpstreamJson` distinguishes a slow cold start from a real
  failure.** financial-sentiment-api is hosted on Render's free tier,
  which spins the app down after idle; a `TimeoutError` gets a distinct
  message hinting at that ("may be waking up from idle") instead of a
  generic failure.

## Auth

Google OAuth via NextAuth, gated by an email allowlist (`ALLOWED_EMAILS`,
`lib/auth.ts`) - fails closed (unset/empty denies everyone). In
development, a `CredentialsProvider` auto-signs in as a fixed dev user,
no real Google credentials needed locally. `proxy.ts` is the NextAuth
middleware gating every route except `/login` and `/api/auth/*` - a valid
session token is sufficient there, since `isAllowedEmail()` was already
enforced at sign-in.

**Idle logout**: signs a user out after 15 minutes of no activity,
persisting the last-activity timestamp to `localStorage` rather than a
plain in-memory timer - a `setTimeout`-only version doesn't survive a
backgrounded mobile tab getting discarded and reloaded.
