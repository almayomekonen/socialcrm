import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const user = request.cookies.get('user')?.value
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/ipuy')) return NextResponse.next()
  if (pathname.startsWith('/thank-you')) return NextResponse.next()

  if (!user && !pathname.startsWith('/auth')) return Response.redirect(new URL('/auth', request.url))

  if (user && pathname.startsWith('/auth')) return Response.redirect(new URL('/', request.url))

  return NextResponse.next()
}

export const config = {
  // matcher: ['/((?!api|_next/static|_next/image|.*\\.png$|manifest\\.json).*)'],
  matcher: ['/((?!api|_next/static|_next/image|.*\\.css$|.*\\.png$|.*\\.jpg$|.*\\.webp$|manifest\\.json).*)'],
}

// includes auth pages
// matcher: ['/((?!api|_next/static|_next/image|.*\\.png$|manifest\\.json|auth(?:/.*)?).*)'],
