import { NextResponse } from 'next/server'
import { listInboxConversations } from '@/modules/inbox/queries'
import { MobileAuthError, requireMobileProductAccess } from '@/lib/mobile/auth'
import { fail, ok } from '@/lib/mobile/http'
import { decodeInboxCursor, encodeInboxCursor, toMobileConversation } from '@/lib/mobile/inbox'

/**
 * GET /api/mobile/v1/inbox/conversations — the WhatsApp inbox list.
 *
 * A THIN ADAPTER over `listInboxConversations`, which already does everything
 * that matters: agency scoping, per-user unread resolution, the product's
 * deliberate "empty threads sort last" rule, keyset pagination, and a bounded
 * limit. None of that is reimplemented here.
 *
 * ORDERING IS THE SERVER'S. No sort parameter is accepted, so the phone shows
 * the same order as the desktop. Re-sorting on device would produce two
 * different answers to "what needs attention first".
 *
 * WHATSAPP-ONLY. `InboxChannel` is the single literal `'whatsapp'`; the client
 * rejects anything else outright. The filter is applied server-side anyway so a
 * future channel cannot silently appear on a phone that cannot render it.
 */

/** The client does not choose. A phone list does not need the web's 100. */
const MOBILE_PAGE_SIZE = 30

export async function GET(req: Request): Promise<NextResponse> {
  let user
  try {
    user = await requireMobileProductAccess(req)
  } catch (err) {
    if (err instanceof MobileAuthError) return fail(err.code, err.status)
    throw err
  }

  /**
   * The cursor is OPAQUE to the client: an encoded blob it received from us and
   * echoes back. It is validated on the way in, so a tampered value is a 400
   * rather than something that reaches a SQL predicate.
   */
  const rawCursor = new URL(req.url).searchParams.get('cursor')
  const cursor = decodeInboxCursor(rawCursor)
  if (rawCursor !== null && cursor === null) return fail('invalid_request', 400)

  try {
    const page = await listInboxConversations(user.agencyId, user.id, {
      cursor,
      limit: MOBILE_PAGE_SIZE,
    })

    return ok({
      items: page.items.map(toMobileConversation),
      nextCursor: encodeInboxCursor(page.nextCursor),
    })
  } catch (err) {
    /**
     * NOT an empty inbox. A `200 { items: [] }` fallback would render "אין
     * שיחות" to a rep who has unanswered customers waiting.
     */
    console.error('[mobile/inbox/conversations] failed', {
      userId: user.id,
      reason: (err as Error)?.message,
    })
    return fail('server_error', 500)
  }
}
