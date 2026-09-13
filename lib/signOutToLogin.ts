import { signOut } from 'next-auth/react';

export function signOutToLogin(options?: { error?: string }): void {
  // Pass pathname to URLSearchParams as-is - it already percent-encodes once;
  // pre-encoding with encodeURIComponent double-encodes and broke every sign-out in production.
  const query = new URLSearchParams({ callbackUrl: window.location.pathname });
  if (options?.error) query.set('error', options.error);
  signOut({ callbackUrl: `/login?${query.toString()}` });
}
