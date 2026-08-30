import { NextResponse } from 'next/server'
import { getInboxConversationListItemById } from '@/modules/inbox/queries'
import { MobileAuthError, requireMobileProductAccess } from '@/lib/mobile/auth'
import { fail, ok } from '@/lib/mobile/http'
import { toMobileConversation } from '@/lib/mobile/inbox'
import { parseLeadId } from '@/lib/leads/leadScope'

/**
 * GET /api/mobile/v1/inbox/conversations/:id — one conversation's header.
 *
 * Reads through `getInboxConversationListItemById`, which is the SAME query and
 * the SAME mapper the list uses. That is deliberate: the thread header must
 * agree with the row the rep tapped, and the only way to guarantee that is to
 * not have a second implementation.
 *
 * NOT FOUND AND OUT-OF-AGENCY ARE THE SAME 404. The reader filters by
 * `cv.agencyId`, so a conversation belonging to another tenant simply does not
 * resolve — the response cannot distinguish "absent" from "not yours", and so
 * conversation ids cannot be walked to discover what exists elsewhere.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user
  try {
    user = await requireMobileProductAccess(req)
  } catch (err) {
    if (err instanceof MobileAuthError) return fail(err.code, err.status)
    throw err
  }

  // Same digits-only, 1..PG_INT_MAX parser the desktop uses for entity ids.
  const { id: rawId } = await params
  const conversationId = parseLeadId(rawId)
  if (conversationId === null) return fail('invalid_request', 400)

  try {
    const item = await getInboxConversationListItemById(user.agencyId, user.id, conversationId)
    if (!item) return fail('not_found', 404)

    /**
     * WhatsApp-only. The client rejects any other channel outright, so a thread
     * it cannot render is reported as absent rather than delivered and failed at
     * the validator.
     */
    if (item.channel !== 'whatsapp') return fail('not_found', 404)

    return ok(toMobileConversation(item))
  } catch (err) {
    console.error('[mobile/inbox/conversations/:id] failed', {
      userId: user.id,
      conversationId,
      reason: (err as Error)?.message,
    })
    return fail('server_error', 500)
  }
}
