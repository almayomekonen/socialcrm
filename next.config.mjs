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
