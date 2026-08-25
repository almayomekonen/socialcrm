/**
 * Content-Security-Policy — TWO policies, on purpose.
 *
 * WHAT WAS ACTUALLY WRONG. The app shipped only
 * `Content-Security-Policy-Report-Only`, which is why every scanner reports
 * "missing CSP": report-only is advisory, so nothing was ever enforced. The
 * comment here promised a flip "once real traffic proves the allowlist
 * complete" — but the policy carried no `report-uri`, so nothing was collecting
 * that proof. Two years of report-only produced zero evidence.
 *
 * Probing production directly (a `securitypolicyviolation` listener on
 * getsocialcrm.com/auth) found two holes the old allowlist would have blocked
 * the day it was enforced:
 *
 *   style-src-elem  https://accounts.google.com/gsi/style   ← the Google
 *       Sign-In button's stylesheet, a <link> in the MAIN document (not inside
 *       the gsi iframe). Enforcing without this un-styles the login button.
 *   connect-src     https://*.on.aws                        ← Meta Pixel
 *       telemetry, POSTed by fbevents.js from the main document.
 *
 * Both are fixed below. `fonts.gstatic.com` was ALSO observed, but only inside
 * Google's own `gsi/button` iframe, which its own CSP governs — so it is
 * deliberately NOT added here.
 *
 * WHY THE ENFORCED POLICY IS LOOSER THAN THE CANDIDATE. The probe covered
 * public pages. It did NOT exercise the authenticated surfaces that talk to the
 * most origins — Google Drive Picker, WhatsApp Embedded Signup, S3 uploads, the
 * copilot PDF worker. Enforcing a tight `connect-src` against surfaces nobody
 * has measured is how a security header becomes an outage.
 *
 * So the enforced policy is strict exactly where strictness cannot break a
 * fetch — `object-src`, `base-uri`, `form-action`, `frame-ancestors`, and the
 * script/style/frame allowlists that ARE evidenced — and stays permissive on
 * `connect-src` until reports say otherwise. That is most of the real value
 * (clickjacking, base-tag injection, form hijacking, arbitrary plugin/object
 * loading) at close to zero breakage risk.
 *
 * The REPORT-ONLY policy is the tightening target: the same policy with the
 * narrow `connect-src` restored. It now reports to /api/security/csp-report, so
 * the next tightening is driven by data instead of by another promise. When the
 * reports are quiet, the candidate becomes the enforced policy.
 */
const REPORT_URI = 'report-uri /api/security/csp-report'

/** Directives shared by both policies. Differences live in the two consts below. */
const cspBase = [
  "default-src 'self'",
  // 'unsafe-inline' is still required: Next injects inline bootstrap scripts,
  // and Tailwind plus React style props produce inline style attributes.
  // Nonces are the follow-up, and they are only worth doing once enforcing.
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com https://connect.facebook.net",
  // accounts.google.com added: proven main-document stylesheet (see above).
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "frame-src 'self' https://accounts.google.com https://content.googleapis.com https://docs.google.com https://www.facebook.com https://staticxx.facebook.com",
  // pdf.js loads its worker from same-origin /copilot/pdf.worker.min.mjs, and
  // falls back to a blob: worker when that path fails. Without this, worker-src
  // inherits default-src 'self' and the fallback dies.
  "worker-src 'self' blob:",
  // The zero-risk, high-value half: none of these can block a resource the app
  // legitimately loads, and together they close clickjacking, base-tag
  // injection, form hijacking and object/plugin injection.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
]

/** ENFORCED. Permissive connect-src until authenticated surfaces are measured. */
const contentSecurityPolicy = [...cspBase, "connect-src 'self' https:", REPORT_URI].join('; ')

/** CANDIDATE, reported only. The narrow connect-src we intend to enforce next. */
const contentSecurityPolicyCandidate = [
  ...cspBase,
  "connect-src 'self' https://accounts.google.com https://www.googleapis.com https://graph.facebook.com https://connect.facebook.net https://www.facebook.com https://*.amazonaws.com https://*.on.aws",
  REPORT_URI,
].join('; ')

/**
 * CROSS-ORIGIN ISOLATION IS DELIBERATELY NOT ENABLED.
 *
 * Full isolation needs BOTH `COOP: same-origin` and `COEP: require-corp`, and
 * both break this product:
 *
 *   COOP: same-origin severs `window.opener` for cross-origin popups. Google
 *   Sign-In runs `display=popup` and posts the credential back to its opener
 *   (verified live on /auth), and WhatsApp Embedded Signup depends on a
 *   `postMessage` from the Facebook popup (lib/facebook/useEmbeddedSignup.ts).
 *   Enabling it logs everyone out of the sign-in flow and kills WhatsApp
 *   onboarding.
 *
 *   COEP: require-corp blocks every cross-origin subresource that does not send
 *   CORP/CORS opt-in — the Facebook SDK, the Google Picker, Cloudinary icons.
 *
 * Isolation buys `SharedArrayBuffer` and high-resolution timers. This app uses
 * neither (grepped: no WebAssembly, no SharedArrayBuffer). So the trade is
 * "break login and WhatsApp onboarding to unlock capabilities we do not use" —
 * which is not a security improvement, it is an outage with a good score.
 *
 * `same-origin-allow-popups` IS set: it gives the isolation benefit that does
 * not cost anything (documents WE open cannot reach back into us) while keeping
 * the OAuth popups we open working. It does not satisfy a scanner looking for
 * full isolation, and that is the correct answer rather than the flattering one.
 *
 * TRUSTED TYPES IS ALSO NOT ENABLED — see the audit note in the same commit.
 * `require-trusted-types-for 'script'` turns every `script.src = string` into a
 * throw. The app has three (Google Picker loader, Facebook SDK loader, Meta
 * Pixel), and Next.js/Turbopack's own chunk loader has more, with no policy
 * registered. Enabling it today breaks client-side navigation.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicyCandidate },
]

/** @type {import('next').NextConfig} */

const nextConfig = {
  images: {
    // Hosts the purchased Lumen template's marketing sections load avatars and
    // logos from. Matches its own next.config; marketing surface only.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'logo.clearbit.com' },
    ],
  },
  /**
   * `/crm` was the Lumen homepage while it was proved out; it is now `/`.
   *
   * A permanent (308) redirect, not a second page: `/crm` is linked from the
   * production nav and has index presence, so it retires by pointing at the
   * canonical homepage rather than 404ing. Config redirects run before the
   * proxy, so this never reaches auth. Fragments survive a 3xx, so any stale
   * `/crm#features-grid` still lands on the right section.
   */
  async redirects() {
    return [
      { source: '/crm', destination: '/', permanent: true },
      /**
       * Retired marketing pages. They were indexed, so they must not simply
       * disappear: without an entry here they fall through to the proxy, which
       * sees a non-public path and 302s them to /auth — a login screen is a
       * dead end for a visitor arriving from a search result, and a soft-404
       * to a crawler. Each points at the closest surviving page so the link
       * equity and the reader both land somewhere that answers the query.
       */
      { source: '/features', destination: '/', permanent: true },
      { source: '/facebook-leads', destination: '/channels', permanent: true },
      { source: '/whatsapp-leads', destination: '/crm-for-whatsapp-business', permanent: true },
    ]
  },
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
