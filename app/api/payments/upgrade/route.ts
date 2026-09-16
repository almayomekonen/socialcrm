import { NextRequest, NextResponse } from 'next/server'
import { requireUser, AuthError } from '@/lib/requireUser'
import { track } from '@/lib/analytics/track'

/**
 * RETIRED. This used to build a Grow Payment Link and redirect the customer to
 * it. Payment Links are gone: billing is the saved-card journey and nothing
 * else, so there is no link left to send anyone to.
 *
 * The route stays because the URL is bookmarked and sits in already-sent
 * emails. It now does one thing: put an authenticated customer on the billing
 * screen, where the current journey starts. It never redirects to a payment
 * provider.
 *
 * `period` is ignored. Annual purchasing does not exist in this release, and
 * honouring an `annual` bookmark would be the worst kind of bug — charging an
 * amount nobody chose.
 */

const BILLING_ROUTE = '/settings/update_payment'

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) {
      // After login, land on the billing screen rather than back on this shim.
      const loginUrl = new URL('/auth', req.url)
      loginUrl.searchParams.set('next', BILLING_ROUTE)
      return NextResponse.redirect(loginUrl, 302)
    }
    console.error('[upgrade] unexpected auth error', { err: String(err) })
    return new NextResponse('Server error', { status: 500 })
  }

  // A click is still a click: this metric predates the route change and the
  // funnel would otherwise gain a hole. track() never throws.
  const source = req.nextUrl.searchParams.get('source') ?? 'unknown'
  await track({ agencyId: user.agencyId, userId: user.id, event: 'upgrade_clicked', props: { source, period: 'monthly' } })

  return NextResponse.redirect(new URL(BILLING_ROUTE, req.url), 302)
}
