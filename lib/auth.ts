import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { isResearchAllowed } from './researchAccess';

const IS_DEV = process.env.NODE_ENV === 'development';
const DEV_EMAIL = 'dev@local.test';

const INSECURE_DEFAULT_SECRET = 'dev-only-insecure-secret-change-me';

if (!IS_DEV && (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET === INSECURE_DEFAULT_SECRET)) {
  throw new Error(
    'NEXTAUTH_SECRET must be set to a real secret outside development — refusing to start with the insecure default.',
  );
}

// This app has no backend database, so - unlike portfolio-manager, where a
// Postgres users table is the single source of truth - the allowlist has to
// live here. Fails closed: an unset/empty ALLOWED_EMAILS denies everyone
// rather than accidentally leaving the site open to any Google account.
const ALLOWED_EMAILS = new Set(
  (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

// Exported so proxy.ts and /api/analyze can require this specifically, not
// just "any signed-in user" - since ALLOWED_EMAILS_RESEARCH-only emails can
// now sign in too (see the signIn callback below), a session alone no
// longer implies ALLOWED_EMAILS membership the way it used to.
export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && ALLOWED_EMAILS.has(email.toLowerCase());
}

export const authOptions: NextAuthOptions = {
  providers: IS_DEV
    ? [
        CredentialsProvider({
          id: 'dev',
          name: 'Development (auto-signin)',
          credentials: {},
          async authorize() {
            return { id: DEV_EMAIL, email: DEV_EMAIL, name: 'Dev User', image: null };
          },
        }),
      ]
    : [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID || '',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        }),
      ],
  callbacks: {
    async signIn({ user }) {
      if (IS_DEV) return true;
      // ALLOWED_EMAILS_RESEARCH is a separate, independent allowlist, not a
      // subset of ALLOWED_EMAILS - an email that's only in the research
      // list must still be able to sign in at all (proxy.ts and
      // /api/analyze then restrict what a non-ALLOWED_EMAILS session can
      // actually reach to /research alone).
      return isAllowedEmail(user.email) || isResearchAllowed(user.email);
    },
  },
  // Absolute ceiling on how long a session cookie is valid, regardless of
  // activity - defense in depth alongside the client-side idle-logout timer
  // (components/SessionProvider.tsx), which is what actually signs an idle
  // user out. This just bounds the worst case (e.g. a tab left open with
  // its JS somehow not running) instead of NextAuth's 30-day default.
  session: { maxAge: 60 * 60 },
  pages: IS_DEV ? {} : { signIn: '/login', error: '/login' },
};
