import { signOut } from 'next-auth/react';

// Signs out and returns to /login with the CURRENT page preserved as
// /login's OWN callbackUrl (?callbackUrl=/login?callbackUrl=<current
// path>) - so signing back in lands back where the user signed out from,
// not always on the main page. /login already reads and forwards this
// same query param (see app/login/page.tsx) for the OTHER path into
// /login: an unauthenticated deep-link visit, which proxy.ts's withAuth
// middleware appends automatically. Plain signOut({ callbackUrl: '/login'
// }) - what both pages used before this - doesn't go through that
// middleware at all, so it never had anything to preserve.
//
// `error` lets a caller (e.g. the idle-logout timer in
// SessionProvider.tsx) surface a reason on /login without giving up path
// preservation - both query params can coexist on the same /login URL.
//
// URLSearchParams.toString() already percent-encodes each value once -
// pre-encoding window.location.pathname with encodeURIComponent before
// handing it to URLSearchParams (as this did until it broke every
// sign-out in production) double-encodes it, so /login's
// searchParams.get('callbackUrl') comes back still percent-escaped
// (e.g. "%2Fresearch%2F...") instead of a real path, which then fails as
// an invalid URL wherever NextAuth's redirect callback consumes it.
export function signOutToLogin(options?: { error?: string }): void {
  const query = new URLSearchParams({ callbackUrl: window.location.pathname });
  if (options?.error) query.set('error', options.error);
  signOut({ callbackUrl: `/login?${query.toString()}` });
}
