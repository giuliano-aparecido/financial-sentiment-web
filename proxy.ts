import { withAuth } from 'next-auth/middleware';
import { NextRequest } from 'next/server';

export const proxy =
  process.env.NODE_ENV === 'development'
    ? (req: NextRequest) => undefined
    : withAuth({
        callbacks: {
          // isAllowedEmail is already enforced in authOptions.callbacks.signIn
          // (lib/auth.ts) - a token existing at all means it passed that
          // check, so there's no second allowlist tier to apply here
          // (research pages/routes moved to financial-research-web, which
          // has its own single-tier ALLOWED_EMAILS_RESEARCH check).
          authorized: ({ token }) => !!token,
        },
        pages: {
          signIn: '/login',
        },
      });

export const config = {
  matcher: ['/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)'],
};
