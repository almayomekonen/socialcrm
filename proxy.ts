import { NextResponse, type NextRequest } from 'next/server'

// Public marketing/SEO pages — accessible without authentication
const PUBLIC_ROUTES = [
  '/',
  '/crm',
  '/features',
  '/facebook-leads',
  '/whatsapp-leads',
  '/crm-vs-excel',
  '/instagram-leads-crm',
  '/crm-for-whatsapp-business',
  '/pricing',
  '/privacy',
  '/terms',
  '/data-deletion',
]

export async function proxy(request: NextRequest) {
  const user = request.cookies.get('user')?.value
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/ipuy')) return NextResponse.next()
  if (pathname.startsWith('/thank-you')) return NextResponse.next()
  // Push service worker (public/sw.js) — push + notificationclick only, no secrets.
  // Must be fetchable without a session so registration/update cannot 302 to /auth.
  if (pathname === '/sw.js') return NextResponse.next()

  // Allow public marketing pages (exact match or nested paths)
  if (PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))) return NextResponse.next()

  if (!user && !pathname.startsWith('/auth')) return Response.redirect(new URL('/auth', request.url))

  if (user && pathname.startsWith('/auth')) return Response.redirect(new URL('/dashboard', request.url))

  return NextResponse.next()
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
