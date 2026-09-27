# Financial RAG Reasoning Engine — Frontend

*An experimental project exploring agentic coding workflows with Claude Code.*
*The backend it talks to is also an experiment in LoRA fine-tuning and
self-hosting a small LLM.*

A single-page Next.js UI for a financial-news sentiment/reasoning demo:
enter a stock query (optionally with a `$TICKER` cashtag), and it proxies
to a separate FastAPI backend —
[`financial-sentiment-api`](https://github.com/giuliano-aparecido/financial-sentiment-api)
— which fetches live news and runs a fine-tuned LLM's chain-of-thought
reasoning against it.

## Documentation

- [`PROJECT.md`](PROJECT.md) — architecture, key design decisions, auth,
  idle logout

## Stack

- **Next.js 16** + **React 19** + **TypeScript**
- **NextAuth.js** — Google OAuth in production (email allowlist), a fixed
  auto-signin dev user locally
- Plain inline styles (`style={{}}`), no CSS framework — this is a small
  enough app that a stylesheet/Tailwind wasn't worth the setup

## Local development

```bash
npm install
cp .env.local.example .env.local   # RAG_API_URL/RAG_API_KEY at minimum;
                                    # auth vars not needed in dev
npm run dev
```

Requires [`financial-sentiment-api`](https://github.com/giuliano-aparecido/financial-sentiment-api)
running (or deployed) at the URL configured in `RAG_API_URL`.

## Tests / build

```bash
npx vitest run    # route-handler tests (analyze proxy error mapping,
                   # rate-limit key isolation)
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
