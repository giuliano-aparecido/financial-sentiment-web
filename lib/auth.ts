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

const ALLOWED_EMAILS = new Set(
  (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

// A signed-in session alone no longer implies this - ALLOWED_EMAILS_RESEARCH-only
// accounts can sign in too (see the signIn callback below).
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
      return isAllowedEmail(user.email) || isResearchAllowed(user.email);
    },
  },
  // Ceiling only, not the real enforcement - components/SessionProvider.tsx's
  // client-side idle timer is what actually signs an idle user out.
  session: { maxAge: 60 * 60 },
  pages: IS_DEV ? {} : { signIn: '/login', error: '/login' },
};
