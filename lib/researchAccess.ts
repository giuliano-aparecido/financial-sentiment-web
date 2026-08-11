// /research pages and their /api/research routes are for a small, separate
// allowlist from ALLOWED_EMAILS (lib/auth.ts), which gates the rest of the
// app - same comma-separated format and same fail-closed stance: unset/empty
// denies everyone rather than leaving /research open to anyone ALLOWED_EMAILS
// lets in.
const ALLOWED_EMAILS_RESEARCH = new Set(
  (process.env.ALLOWED_EMAILS_RESEARCH || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

export function isResearchAllowed(email: string | null | undefined): boolean {
  return !!email && ALLOWED_EMAILS_RESEARCH.has(email.toLowerCase());
}
