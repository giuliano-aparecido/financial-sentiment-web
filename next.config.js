/** @type {import('next').NextConfig} */
const IS_DEV = process.env.NODE_ENV === 'development';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    // 'unsafe-inline' on script/style is required by this app as built -
    // every component uses React's style={{}} prop (inline style
    // attributes), and Next's App Router injects inline hydration scripts.
    // Tightening those to nonces would mean moving off inline styles
    // first. default-src/frame-ancestors/object-src still meaningfully
    // narrow what the page can load and whether it can be framed.
    //
    // 'unsafe-eval' is added to script-src only in development - React's
    // dev tooling and Turbopack's HMR use eval() for things like
    // reconstructing call stacks and hot-reloading. Production Next.js
    // never uses eval() at all, so the deployed CSP stays strict.
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${IS_DEV ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
