const ALLOWED_EMAILS_RESEARCH = new Set(
  (process.env.ALLOWED_EMAILS_RESEARCH || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

export function isResearchAllowed(email: string | null | undefined): boolean {
  return !!email && ALLOWED_EMAILS_RESEARCH.has(email.toLowerCase());
}
