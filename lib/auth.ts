import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';

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
      return !!user.email && ALLOWED_EMAILS.has(user.email.toLowerCase());
    },
  },
  pages: IS_DEV ? {} : { signIn: '/login', error: '/login' },
};
