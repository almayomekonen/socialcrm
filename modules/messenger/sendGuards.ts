import 'server-only'

import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
import { parseGrantedScopes } from '@/db/facebook'
import { hasFeatureScopes, isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { revalidatePath } from 'next/cache'
import { bumpMessengerConversation, recordSentMessengerMessage } from '@/db/messenger'
import { markNotificationsReadByCollapseKey } from '@/db/notifications/reads'
import { messengerConversationInboundKey } from '@/lib/notifications/collapseKeys'
import { describeGraphError, type MetaGraphError } from '@/lib/facebook/graphClient'
import { markFacebookDisconnectedAndNotify } from '@/lib/facebook/integrationNotifications'
import type { MessengerAttachment } from '@/lib/facebook/messenger/parseMessagingEvent'
import { messengerWindow, sendFailureFromGraph, type MessengerSendFailure } from '@/lib/facebook/messenger/rules'
import type { FacebookPageConnection } from '@/lib/facebook/integrationNotifications'

/**
 * The one authorization chain for sending anything to a Messenger contact.
 *
 * Extracted so text and media cannot drift apart: a second copy of this is how a
 * feature ends up able to send a photo outside the 24-hour window, or to a Page
 * belonging to another tenant, long after the text path was made safe.
 *
 * ORDER MATTERS, and it is the cheap-and-decisive checks first:
 *   1. product access  — an outbound message is billable work (throws; useAction
 *                        turns it into the subscription state, as before)
 *   2. rollout gate    — is Messenger on for this agency at all
 *   3. ownership       — the conversation belongs to the CALLER's agency
 *   4. window          — the 24-hour standard messaging window, server-side,
 *                        before Meta is ever called
 *   5. Page + grant    — the conversation's own Page, inside the same agency,
 *                        with pages_messaging actually recorded on its token
 *   6. token           — and only now is a credential opened
 *
 * The PSID and the Page token are resolved HERE, from the row, and never come
 * from or go to the client: the browser only ever names a conversation id.
 */

export type MessengerSendContext = {
  userId: number
  agencyId: number
  conversationId: number
  pageId: string
  psid: string
  pageAccessToken: string
  connection: FacebookPageConnection
}

/** Narrowed with `'reason' in guard` — see AttachmentCheck for why not `.ok`. */
export type MessengerSendGuard = { ctx: MessengerSendContext } | { reason: MessengerSendFailure }

export async function authorizeMessengerSend(conversationId: number): Promise<MessengerSendGuard> {
  const user = await requireProductAccess()
  if (!isFacebookMessengerEnabledForAgency(user.agencyId)) return { reason: 'not_enabled' }

  const id = Number(conversationId)
  if (!Number.isInteger(id) || id <= 0) return { reason: 'not_found' }

  const conversation = await db('messenger_conversations').where({ id, agencyId: user.agencyId }).first()
  if (!conversation) return { reason: 'not_found' }

  if (!messengerWindow(conversation.lastInboundAt, new Date()).open) return { reason: 'window_closed' }

  const connection = await db('facebook_pages')
    .where({ page_id: conversation.pageId, agency_id: user.agencyId })
    .first()
  if (!connection) return { reason: 'reconnect_required' }
  if (!hasFeatureScopes(parseGrantedScopes(connection.granted_scopes), 'messenger')) {
    return { reason: 'permission_missing' }
  }

  let pageAccessToken: string
  try {
    pageAccessToken = resolvePageAccessToken(connection.page_access_token)
  } catch {
    console.error('[MessengerSend] Page token could not be opened')
    return { reason: 'meta_error' }
  }

  return {
    ctx: {
      userId: user.id,
      agencyId: user.agencyId,
      conversationId: id,
      pageId: conversation.pageId,
      psid: conversation.psid,
      pageAccessToken,
      connection,
    },
  }
}

export type MessengerSendResult = { ok: true } | { ok: false; reason: MessengerSendFailure; detail?: string }

/**
 * These live HERE and not in actions.ts on purpose.
 *
 * `actions.ts` is a `'use server'` module, where EVERY export becomes an
 * individually addressable RPC endpoint — reachable by any authenticated user,
 * with arguments of their choosing, whether or not the app ever calls it. A
 * shared helper that takes an already-authorized context and writes to the
 * database is exactly the shape that must never be exported from such a module.
 * (The same reasoning removed `updateAgency` from actions/agencies.ts.)
 */

/** Classify a Meta refusal, log it without content, and notice a dead token. */
export async function failFromGraph(error: MetaGraphError, ctx: MessengerSendContext): Promise<MessengerSendResult> {
  const reason = sendFailureFromGraph(error)
  console.warn('[MessengerSend] Meta refused the message', { reason, detail: describeGraphError(error) })
  if (reason === 'reconnect_required') await markFacebookDisconnectedAndNotify(ctx.connection).catch(() => {})
  return { ok: false, reason }
}

/** Mark a conversation read for one user, and close its notification row. */
export async function markMessengerRead(conversationId: number, agencyId: number, userId: number) {
  await db('messenger_conversation_reads')
    .insert({ conversationId, userId, agencyId, lastReadAt: new Date() })
    .onConflict(['conversationId', 'userId'])
    .merge({ lastReadAt: new Date() })
  // Read or answered here ⇒ the bell row for it is done, so the customer's NEXT
  // message is a new notification (toast / push) instead of a silent collapse.
  await markNotificationsReadByCollapseKey({
    agencyId,
    userId,
    collapseKey: messengerConversationInboundKey(conversationId),
  }).catch(() => {})
}

/**
 * Record what Meta accepted.
 *
 * Whichever of this and the `message_echoes` webhook lands second converges on
 * the same ("pageId", mid) row; if the echo won the race, this attributes the
 * sender instead of losing it. A failure here is logged, never surfaced: the
 * message IS delivered at this point and the echo will still record it, so
 * telling the rep it failed would be a lie that makes them send it twice.
 */
export async function recordOutbound(
  ctx: MessengerSendContext,
  input: { mid: string; text: string; attachments: MessengerAttachment[] },
) {
  const now = new Date()
  try {
    await db.transaction(async (trx) => {
      const { created } = await recordSentMessengerMessage(trx, {
        conversationId: ctx.conversationId,
        agencyId: ctx.agencyId,
        pageId: ctx.pageId,
        mid: input.mid,
        text: input.text,
        sentByUserId: ctx.userId,
        at: now,
        attachments: input.attachments,
      })
      if (created) {
        await bumpMessengerConversation(trx, {
          conversationId: ctx.conversationId,
          direction: 'outbound',
          at: now,
          text: input.text,
          attachments: input.attachments,
        })
      }
    })
  } catch (err) {
    console.error('[MessengerSend] Sent, but local record failed:', err instanceof Error ? err.message : 'unknown')
  }
  await markMessengerRead(ctx.conversationId, ctx.agencyId, ctx.userId).catch(() => {})
  revalidatePath('/inbox/messenger')
}
