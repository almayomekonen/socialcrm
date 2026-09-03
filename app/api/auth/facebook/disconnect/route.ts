import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { requireActiveAgencyUser, statusFor } from '@/lib/api/routeAuth'

/**
 * Disconnect the caller's connected Facebook Page.
 *
 * PAGE-SPECIFIC, NOT AGENCY-WIDE, and the callers say so unambiguously. The one
 * caller — `FacebookConnect.tsx` — posts no body, holds a single
 * `{ pageId, pageName }`, names its handler `disconnectPage`, confirms with
 * "לנתק את הדף X?" and reports "הדף נותק בהצלחה". The connection it displays is
 * read as `where({ user_id })` in both `LeadSourcesSection` and
 * `IntegrationsMobile`. The operation the product offers is "disconnect MY
 * Page", and this route implements exactly that.
 *
 * THE BUG THIS REPLACES. A previous revision let an admin match every row in the
 * agency, resolved ONE row with `.first()` to unsubscribe at Meta, then deleted
 * the whole matched set. `facebook_pages` is unique on `page_id`, not on agency,
 * so an agency can hold several Pages: an admin with two connected Pages lost
 * both locally while only one was unsubscribed, leaving Meta delivering webhooks
 * for a Page with no local row and no token left to unsubscribe it.
 *
 * The rule that stops it recurring: the row that is unsubscribed and the row
 * that is deleted must be THE SAME ROW, addressed by primary key. Never resolve
 * with `.first()` and delete by a filter that can match more.
 *
 * Admin reach over another user's row is deliberately NOT reintroduced. Nothing
 * is stranded without it — connecting is admin-only now, and the owner of any row
 * created under the earlier unguarded flow can still remove it — and no surface
 * could express "disconnect someone else's Page": an admin's own screen shows
 * only their own connection. Adding that is a product decision with its own UI,
 * not a bug fix.
 */
export async function POST(_req: NextRequest) {
  const auth = await requireActiveAgencyUser()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const user = auth.user

  // Self-scoped, with the tenant filter underneath it. The agency clause is
  // redundant while `user_id` implies the tenant, and it stays anyway: isolation
  // should not depend on another column continuing to imply it.
  const connection = await db('facebook_pages')
    .where({ agency_id: user.agencyId, user_id: user.id })
    .first()
  if (!connection) return NextResponse.json({ ok: true })

  // Attempt to unsubscribe the page — best effort, don't block deletion on failure
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${connection.page_id}/subscribed_apps?access_token=${connection.page_access_token}`,
      { method: 'DELETE' },
    )
    if (!res.ok) {
      console.warn(`[FacebookDisconnect] Unsubscribe failed [pageId=${connection.page_id}]:`, await res.text())
    } else {
      console.log(`[FacebookDisconnect] Page unsubscribed [pageId=${connection.page_id}]`)
    }
  } catch (err) {
    console.warn(`[FacebookDisconnect] Unsubscribe threw [pageId=${connection.page_id}]:`, err)
  }

  // Delete the exact row that was just unsubscribed, by primary key. A filter
  // here — even the one the row was found by — is what allowed the over-delete.
  await db('facebook_pages').where({ id: connection.id }).delete()

  return NextResponse.json({ ok: true })
}
