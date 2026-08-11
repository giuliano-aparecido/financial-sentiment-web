import { withAuth } from 'next-auth/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { isResearchAllowed } from '@/lib/researchAccess';

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
          // 404, not a redirect to /login or '/' - other ALLOWED_EMAILS
          // users are already authenticated at this point (the `authorized`
          // callback below already passed), so a redirect to /login would
          // just bounce them straight back here in a loop. Isolating
          // /research means pretending it doesn't exist to them.
          if (isResearchPath && !isResearchAllowed(req.nextauth.token?.email)) {
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
