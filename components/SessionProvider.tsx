'use client';

import { SessionProvider as NextAuthSessionProvider, useSession } from 'next-auth/react';
import { ReactNode, useEffect, useRef } from 'react';
import { signOutToLogin } from '@/lib/signOutToLogin';

// No activity for this long signs the user out. 15 minutes is generous
// enough not to interrupt someone reading a long analysis, but short enough
// that a walked-away, still-open tab doesn't stay signed in indefinitely.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
const STORAGE_KEY = 'idleLogout:lastActivityAt';
// Tracks which session's `expires` value STORAGE_KEY's timestamp was
// recorded for - see scheduleFromLastActivity's own comment for why this
// exists.
const SESSION_MARKER_KEY = 'idleLogout:sessionExpires';

function IdleLogoutWatcher() {
  const { data: session } = useSession();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!session) return;

    const doSignOut = () => {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SESSION_MARKER_KEY);
      // Goes through signOutToLogin (not a plain signOut call) so the page
      // the user was idled out on is preserved as /login's callbackUrl,
      // same as the manual "Sign out" button - otherwise re-signing in
      // always landed on '/' instead of back on e.g.
      // /research/volatility.
      signOutToLogin({ error: 'SessionExpired' });
    };

    // A plain in-memory setTimeout resets to a fresh IDLE_TIMEOUT_MS on
    // every page load, with no memory of how long the user was actually
    // away - on mobile, where the browser routinely discards a
    // backgrounded tab and reloads it fresh, that means reopening the app
    // hours later silently grants a brand new 15-minute grace period
    // instead of signing out. Persisting the last-activity timestamp and
    // checking elapsed wall-clock time against it (rather than trusting a
    // timer to have fired on schedule) closes that gap.
    const scheduleFromLastActivity = () => {
      if (timerRef.current) clearTimeout(timerRef.current);

      // A stored timestamp only means anything if it was recorded for THIS
      // session. session.expires changes on every fresh sign-in (a brand
      // new JWT) - a mismatch here means whatever's in localStorage was
      // left behind by a previous session that ended WITHOUT going through
      // doSignOut (browser/tab closed outright, laptop slept through the
      // idle window, the 1-hour session cookie ceiling elapsing with no JS
      // running to notice - see lib/auth.ts's maxAge), not a stale-but-
      // still-relevant reading. Confirmed live: trusting it unconditionally
      // signed freshly-authenticated users straight back out, immediately,
      // every time - a leftover timestamp from hours/days ago always read
      // as "already past the 15-minute limit." Any marker mismatch is
      // therefore always treated as fresh activity, never as staleness.
      const storedMarker = localStorage.getItem(SESSION_MARKER_KEY);
      let lastActivityAt: number;
      if (storedMarker !== session.expires) {
        lastActivityAt = Date.now();
        localStorage.setItem(STORAGE_KEY, String(lastActivityAt));
        localStorage.setItem(SESSION_MARKER_KEY, session.expires);
      } else {
        const stored = Number(localStorage.getItem(STORAGE_KEY));
        lastActivityAt = stored || Date.now();
      }

      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt);
      if (remaining <= 0) {
        doSignOut();
        return;
      }
      timerRef.current = setTimeout(doSignOut, remaining);
    };

    const recordActivity = () => {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
      localStorage.setItem(SESSION_MARKER_KEY, session.expires);
      scheduleFromLastActivity();
    };

    scheduleFromLastActivity();

    // setTimeout is throttled or fully suspended in backgrounded mobile
    // tabs, so a scheduled sign-out can miss its fire time entirely -
    // re-checking elapsed time whenever the tab regains visibility catches
    // up regardless of what the browser did with timers while hidden.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleFromLastActivity();
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, recordActivity));
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, recordActivity));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [session]);

  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <NextAuthSessionProvider>
      <IdleLogoutWatcher />
      {children}
    </NextAuthSessionProvider>
  );
}
