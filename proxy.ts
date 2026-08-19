import { withAuth } from 'next-auth/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';
import { isAllowedEmail } from '@/lib/auth';

// Covers both the pages (/research/*) and their own API routes
// (/api/research/*) - the matcher below already lets /api/research/*
// through to this proxy (only api/auth is excluded), so one check here
// covers both instead of needing this duplicated into the route handlers'
// own gate.
const RESEARCH_PATH_PREFIXES = ['/research', '/api/research'];

export const proxy =
  process.env.NODE_ENV === 'development'
    ? (req: NextRequest) => undefined
    : withAuth(
        function proxy(req) {
          const { pathname } = req.nextUrl;
          const isResearchPath = RESEARCH_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
          const email = req.nextauth.token?.email;
          // ALLOWED_EMAILS and ALLOWED_EMAILS_RESEARCH are independent
          // allowlists (see lib/auth.ts's signIn callback) - a session no
          // longer implies ALLOWED_EMAILS membership on its own, so the
          // non-research branch has to check it explicitly here too, not
          // just research paths.
          const isAllowedForPath = isResearchPath ? isResearchAllowed(email) : isAllowedEmail(email);
          // 404, not a redirect to /login or '/' - a signed-in user who
          // just lacks permission for this specific area is already
          // authenticated at this point (the `authorized` callback below
          // already passed), so a redirect to /login would just bounce
          // them straight back here in a loop. Pretend the area doesn't
          // exist to them instead.
          if (!isAllowedForPath) {
            return new NextResponse(null, { status: 404 });
          }
          return undefined;
        },
        {
          callbacks: {
            authorized: ({ token }) => !!token,
          },
          pages: {
            signIn: '/login',
          },
        },
      );

export const config = {
  matcher: ['/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)'],
};
