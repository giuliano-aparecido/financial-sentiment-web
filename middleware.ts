import { withAuth } from 'next-auth/middleware';
import { NextRequest } from 'next/server';

export const middleware =
  process.env.NODE_ENV === 'development'
    ? (req: NextRequest) => undefined
    : withAuth(
        function middleware() {
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
