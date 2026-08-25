import { NextResponse, type NextRequest } from 'next/server'
import {
  DEVICE_OVERRIDE_HEADER,
  DEVICE_OVERRIDE_PARAM,
  isDeviceOverrideAllowed,
  parseDeviceOverride,
} from '@/lib/deviceOverride'

// Public marketing/SEO pages — accessible without authentication
const PUBLIC_ROUTES = [
  '/',
  '/crm',
  '/pricing',
  '/channels',
  '/faq',
  // SEO acquisition pages: deliberately outside the primary navigation, but
  // they exist to be entered from search, so they must stay crawlable.
  '/instagram-leads-crm',
  '/crm-for-whatsapp-business',
  '/crm-vs-excel',
  '/privacy',
  '/terms',
  '/data-deletion',
]

export async function proxy(request: NextRequest) {
  const user = request.cookies.get('user')?.value
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/ipuy')) return NextResponse.next()
  if (pathname.startsWith('/thank-you')) return NextResponse.next()
  /**
   * Crawler manifests. Neither is in PUBLIC_ROUTES and the matcher does not
   * exclude .xml/.txt, so both were falling through to the auth redirect below
   * and answering Googlebot with a 302 to /auth — the sitemap could not be
   * fetched at all, which makes every entry in it moot. They contain nothing
   * but public marketing URLs.
   */
  if (pathname === '/sitemap.xml' || pathname === '/robots.txt') return NextResponse.next()
  // Push service worker (public/sw.js) — push + notificationclick only, no secrets.
  // Must be fetchable without a session so registration/update cannot 302 to /auth.
  if (pathname === '/sw.js') return NextResponse.next()

  // Allow public marketing pages (exact match or nested paths)
  if (PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))) return NextResponse.next()

  if (!user && !pathname.startsWith('/auth')) return Response.redirect(new URL('/auth', request.url))

  if (user && pathname.startsWith('/auth')) return Response.redirect(new URL('/dashboard', request.url))

  return appResponse(request)
}

/**
 * The response for an authenticated route: the development device override, and
 * nothing else.
 *
 * `?device=phone` is translated into a request header so any Server Component
 * can read it via `getDeviceClass()` without every page threading `searchParams`
 * down to the device layer. The inbound value is DELETED first, unconditionally
 * and in every environment, so this header can only ever mean "the proxy read it
 * off this URL" and never "a client sent it". It is set only when
 * `isDeviceOverrideAllowed()` is true, and `lib/device.ts` re-checks that guard
 * before reading — a production build ignores the header even if one arrives.
 *
 * Stateless by construction: no cookie is written, so the override lives in the
 * URL and nowhere else. A client-side navigation that drops the query string
 * therefore drops the override, which is the intended trade — an override that
 * persisted invisibly is exactly the kind of hidden state that makes "why is my
 * browser rendering the phone app" a debugging session.
 *
 * NO `Vary` IS SET HERE, deliberately. `Vary: User-Agent` was implemented at
 * this layer first and MEASURED against a running server: Next overwrites `Vary`
 * on every rendered App Router response with its own router values
 * (`rsc, next-router-state-tree, next-router-prefetch,
 * next-router-segment-prefetch, Accept-Encoding`), so a middleware-set value
 * never reaches the client. Shipping a header that provably does not survive
 * would be protection in name only. The declaration lives in
 * `next.config.mjs` instead — see the `Vary` block there for the measurement and
 * for what actually keeps phone and desktop HTML apart.
 */
function appResponse(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete(DEVICE_OVERRIDE_HEADER)
  // Path for phone loading UI. Deleted first so a client cannot spoof it;
  // the value is always this request's own URL. Does not participate in
  // DeviceClass — getDeviceClass() never reads it.
  requestHeaders.delete('x-socialcrm-path')
  requestHeaders.set(
    'x-socialcrm-path',
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  )

  if (isDeviceOverrideAllowed()) {
    const override = parseDeviceOverride(request.nextUrl.searchParams.get(DEVICE_OVERRIDE_PARAM))
    if (override) requestHeaders.set(DEVICE_OVERRIDE_HEADER, override)
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  // matcher: ['/((?!api|_next/static|_next/image|.*\\.png$|manifest\\.json).*)'],
  // .mjs is excluded so static module assets like /copilot/pdf.worker.min.mjs
  // are served directly without going through auth — they're public worker
  // bundles, not protected routes.
  // sw.js is excluded for the same reason: the notification push service worker
  // (P3.1) must register without a 302 to /auth (spec §15.2 / §20.7).
  // media/video is excluded so the activation hero video (mp4/webm) is served
  // directly as a static asset — not routed through auth (which 302'd it and
  // added overhead to range requests). Narrow path exclusion, not a blanket
  // extension exclusion, so no other content is exposed.
  matcher: ['/((?!api|_next/static|_next/image|media/video|sw\\.js$|.*\\.css$|.*\\.mjs$|.*\\.png$|.*\\.jpg$|.*\\.webp$|.*\\.svg$|manifest\\.json).*)'],
}

// includes auth pages
// matcher: ['/((?!api|_next/static|_next/image|.*\\.png$|manifest\\.json|auth(?:/.*)?).*)'],
