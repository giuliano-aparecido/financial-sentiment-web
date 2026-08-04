'use client';

import { SessionProvider as NextAuthSessionProvider, signOut, useSession } from 'next-auth/react';
import { ReactNode, useEffect, useRef } from 'react';

// No activity for this long signs the user out. 15 minutes is generous
// enough not to interrupt someone reading a long analysis, but short enough
// that a walked-away, still-open tab doesn't stay signed in indefinitely.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

function IdleLogoutWatcher() {
  const { data: session } = useSession();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!session) return;

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        signOut({ callbackUrl: '/login?error=SessionExpired' });
      }, IDLE_TIMEOUT_MS);
    };

    resetTimer();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer));

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
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
