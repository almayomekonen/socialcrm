/**
 * Content-Security-Policy — shipped in REPORT-ONLY mode first.
 *
 * The allowlist below is derived from the origins the app actually loads:
 * Google Sign-In (accounts.google.com), Google Picker (apis.google.com,
 * docs.google.com), and the Meta Pixel / FB SDK (connect.facebook.net,
 * www.facebook.com). Report-Only means violations are reported but nothing is
 * blocked, so a missed origin cannot break the UI. Once real traffic proves the
 * allowlist complete, this flips to the enforcing `Content-Security-Policy`.
 *
 * 'unsafe-inline' is currently required for scripts (Next injects inline
 * bootstrap scripts) and styles (Tailwind/inline style attributes). Tightening
 * script-src with nonces is a follow-up once the policy is enforcing.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com https://www.googleapis.com https://graph.facebook.com https://*.amazonaws.com",
  "frame-src 'self' https://accounts.google.com https://content.googleapis.com https://docs.google.com https://www.facebook.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

// Enforced headers. None of these can change rendering: the app has no
// self-framing iframes (so DENY is safe) and uses no camera/microphone/
// geolocation APIs (verified by grep before enabling the Permissions-Policy).
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
]

/** @type {import('next').NextConfig} */

const nextConfig = {
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The magic-link token travels in the query string; never send that URL
      // as a Referer to anything, not even same-origin subresources.
      { source: '/api/magic', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      /**
       * DEVICE-DEPENDENT RESPONSES VARY ON THE USER-AGENT.
       *
       * This app serves DIFFERENT HTML to a phone and to a desktop for the same
       * URL: the entity (mobile workspace vs. desktop workspace) is chosen
       * server-side from the User-Agent — see `lib/device.ts`. Without this
       * declaration, any cache holding one response is entitled to serve it to
       * the other device: a mobile shell on a laptop, or a desktop table on a
       * phone.
       *
       * WHAT WAS MEASURED, against a running server rather than assumed:
       *
       *   1. Set in `proxy.ts` (middleware) → DISCARDED. Every rendered App
       *      Router response came back with Next's own router values only:
       *      `rsc, next-router-state-tree, next-router-prefetch,
       *       next-router-segment-prefetch, Accept-Encoding`.
       *   2. Declared here → survives on responses Next does not render (e.g.
       *      the middleware sign-in redirect), and is ALSO overwritten by the
       *      same router values on rendered pages.
       *
       * So Next owns `Vary` on rendered App Router responses and neither layer
       * can add to it. Nothing here overwrites those router values — losing them
       * would let a cache serve an RSC flight payload where a document was
       * requested, which is why this rule is scoped rather than global.
       *
       * WHAT ACTUALLY KEEPS PHONE AND DESKTOP HTML APART is stronger than
       * `Vary`: every device-dependent response is dynamic by construction. The
       * (app) layout reads `cookies()` (the session) and `headers()` (the
       * User-Agent), so under `cacheComponents` these pages can never be
       * prerendered or shared-cached — they are served `Cache-Control: no-store,
       * must-revalidate` (verified). `no-store` forbids STORING the response at
       * all, which subsumes "do not reuse it for a different User-Agent". There
       * is therefore no cache in which phone HTML could be held and replayed to
       * a desktop.
       *
       * This rule is kept as the explicit DECLARATION of that intent, at the one
       * layer that can express it: it is correct where it applies, costs a
       * single header, and starts protecting rendered responses the day Next
       * stops taking sole ownership of `Vary`.
       *
       * SCOPED BY SESSION COOKIE, not by path. `has: cookie 'user'` is exactly
       * "authenticated, therefore device-dependent". Anonymous requests to the
       * marketing pages are byte-identical for every device and are the
       * responses that genuinely benefit from CDN caching; they are left
       * untouched rather than sharded per User-Agent string.
       */
      {
        source: '/:path*',
        has: [{ type: 'cookie', key: 'user' }],
        headers: [{ key: 'Vary', value: 'User-Agent' }],
      },
    ]
  },
  typedRoutes: false,
  cacheComponents: true,
  reactCompiler: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '9mb',
    },
  },
  devIndicators: false,
  webpack: (config) => {
    config.resolve.alias.canvas = false
    return config
  },
  turbopack: {},
  serverExternalPackages: ['knex'],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '**/*': ['./migrations/**/*', './public/fonts/**/*'],
  },
}

export default nextConfig
