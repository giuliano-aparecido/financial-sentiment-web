// Single source of truth for the indicator scan's allowed threshold
// percentages. Deliberately has no React (or other client-only)
// dependency: it's imported both by lib/volatilityScans.ts (a client
// module, for the <select> options) and by the
// app/api/research/volatility/indicator[/start]/route.ts server route
// handlers (for request validation). Importing volatilityScans.ts
// itself from those server routes would pull in its useRef/useState
// usage and break the server bundle ("You're importing a module that
// depends on useRef into a React Server Component module") - that's
// why this lives in its own hook-free file instead of being exported
// straight from volatilityScans.ts.
export const THRESHOLD_OPTIONS = [2, 3, 5] as const;

// String form for the route handlers, which validate `threshold_pct`
// as a query-string value. Derived from THRESHOLD_OPTIONS rather than
// declared separately so there's exactly one place to change if a
// threshold is ever added/removed.
export const THRESHOLD_OPTION_STRINGS: readonly string[] = THRESHOLD_OPTIONS.map(String);
