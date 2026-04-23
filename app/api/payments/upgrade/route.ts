import { NextRequest, NextResponse } from 'next/server'
import { requireUser, AuthError } from '@/lib/requireUser'
import { getUpgradeLink } from '@/lib/payments/link'

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) {
      console.warn('[upgrade] auth failed', { reason: err.reason })
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', '/api/payments/upgrade')
      return NextResponse.redirect(loginUrl, 302)
    }
    console.error('[upgrade] unexpected auth error', { err: String(err) })
    return new NextResponse('Server error', { status: 500 })
  }

  try {
    const url = getUpgradeLink(user.agencyId)
    return NextResponse.redirect(url, 302)
  } catch (err) {
    console.error('[upgrade] link build failed', { agencyId: user.agencyId, err: String(err) })
    return new NextResponse('Payments not configured', { status: 500 })
  }
}
