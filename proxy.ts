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

  // Diagnostic-only context (no behavior impact). See [DIAG] logs below.
  const cookiePresent = Boolean(user)
  const ua = request.headers.get('user-agent') ?? ''

  if (pathname.startsWith('/ipuy')) return NextResponse.next()
  if (pathname.startsWith('/thank-you')) return NextResponse.next()

  // Allow public marketing pages (exact match or nested paths)
  if (PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))) return NextResponse.next()

  if (!user && !pathname.startsWith('/auth')) {
    console.log(
      JSON.stringify({
        tag: 'PROXY',
        pathname,
        cookiePresent,
        redirectTo: '/auth',
        reason: 'no_cookie_protected_route',
        ua,
        ts: new Date().toISOString(),
      }),
    )
    return Response.redirect(new URL('/auth', request.url))
  }

  if (user && pathname.startsWith('/auth')) {
    console.log(
      JSON.stringify({
        tag: 'PROXY',
        pathname,
        cookiePresent,
        redirectTo: '/dashboard',
        reason: 'cookie_present_on_auth',
        ua,
        ts: new Date().toISOString(),
      }),
    )
    return Response.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  // matcher: ['/((?!api|_next/static|_next/image|.*\\.png$|manifest\\.json).*)'],
  // .mjs is excluded so static module assets like /copilot/pdf.worker.min.mjs
  // are served directly without going through auth — they're public worker
  // bundles, not protected routes.
  matcher: ['/((?!api|_next/static|_next/image|.*\\.css$|.*\\.mjs$|.*\\.png$|.*\\.jpg$|.*\\.webp$|.*\\.svg$|manifest\\.json).*)'],
}

// includes auth pages
// matcher: ['/((?!api|_next/static|_next/image|.*\\.png$|manifest\\.json|auth(?:/.*)?).*)'],
