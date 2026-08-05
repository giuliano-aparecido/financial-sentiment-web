'use client';

import { SessionProvider as NextAuthSessionProvider, signOut, useSession } from 'next-auth/react';
import { ReactNode, useEffect, useRef } from 'react';

// No activity for this long signs the user out. 15 minutes is generous
// enough not to interrupt someone reading a long analysis, but short enough
// that a walked-away, still-open tab doesn't stay signed in indefinitely.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
const STORAGE_KEY = 'idleLogout:lastActivityAt';

function IdleLogoutWatcher() {
  const { data: session } = useSession();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!session) return;

    const doSignOut = () => {
      localStorage.removeItem(STORAGE_KEY);
      signOut({ callbackUrl: '/login?error=SessionExpired' });
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
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      const lastActivityAt = stored || Date.now();
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt);
      if (remaining <= 0) {
        doSignOut();
        return;
      }
      timerRef.current = setTimeout(doSignOut, remaining);
    };

    const recordActivity = () => {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
      scheduleFromLastActivity();
    };

    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    }
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
