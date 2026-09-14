'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireAgencyUser, requireProductAccess } from '@/lib/requireUser'
import { parseGrantedScopes } from '@/db/facebook'
import { bumpMessengerConversation, recordSentMessengerMessage } from '@/db/messenger'
import { hasFeatureScopes, isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { describeGraphError } from '@/lib/facebook/graphClient'
import { markFacebookDisconnectedAndNotify } from '@/lib/facebook/integrationNotifications'
import { sendMessengerText } from '@/lib/facebook/messenger/send'
import {
  MESSENGER_TEXT_MAX,
  messengerWindow,
  sendFailureFromGraph,
  type MessengerSendFailure,
} from '@/lib/facebook/messenger/rules'

export type MessengerSendResult = { ok: true } | { ok: false; reason: MessengerSendFailure }

/**
 * Reply in a Messenger conversation as the Page.
 *
 * Server-side, in order: product access (an outbound message, like a WhatsApp
 * send — its entitlement error propagates to `useAction`); rollout gate;
 * conversation owned by the caller's agency; the 24-hour window measured from
 * the customer's last message; the conversation's own Page inside the same
 * agency, with `pages_messaging` in its recorded grant. Only then is Meta
 * called. The PSID and the token never come from, or go to, the client.
 */
export async function sendMessengerReply(conversationId: number, text: string): Promise<MessengerSendResult> {
  const user = await requireProductAccess()
  if (!isFacebookMessengerEnabledForAgency(user.agencyId)) return { ok: false, reason: 'not_enabled' }

  const body = typeof text === 'string' ? text.trim() : ''
  if (!body) return { ok: false, reason: 'empty' }
  if (body.length > MESSENGER_TEXT_MAX) return { ok: false, reason: 'too_long' }

  const id = Number(conversationId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'not_found' }
  const conversation = await db('messenger_conversations').where({ id, agencyId: user.agencyId }).first()
  if (!conversation) return { ok: false, reason: 'not_found' }

  if (!messengerWindow(conversation.lastInboundAt, new Date()).open) return { ok: false, reason: 'window_closed' }

  const connection = await db('facebook_pages')
    .where({ page_id: conversation.pageId, agency_id: user.agencyId })
    .first()
  if (!connection) return { ok: false, reason: 'reconnect_required' }
  if (!hasFeatureScopes(parseGrantedScopes(connection.granted_scopes), 'messenger')) {
    return { ok: false, reason: 'permission_missing' }
  }

  let pageAccessToken: string
  try {
    pageAccessToken = resolvePageAccessToken(connection.page_access_token)
  } catch {
    console.error('[MessengerSend] Page token could not be opened')
    return { ok: false, reason: 'meta_error' }
  }

  const sent = await sendMessengerText({ pageId: conversation.pageId, pageAccessToken, psid: conversation.psid, text: body })
  if ('error' in sent) {
    const reason = sendFailureFromGraph(sent.error)
    console.warn('[MessengerSend] Meta refused the message', { reason, detail: describeGraphError(sent.error) })
    if (reason === 'reconnect_required') await markFacebookDisconnectedAndNotify(connection).catch(() => {})
    return { ok: false, reason }
  }

  // Recorded from Meta's response. Whichever of this and the `message_echoes`
  // webhook lands second converges on the same ("pageId", mid) row; if the echo
  // won the race, this attributes the sender instead of losing it.
  const now = new Date()
  try {
    await db.transaction(async (trx) => {
      const { created } = await recordSentMessengerMessage(trx, {
        conversationId: id,
        agencyId: user.agencyId,
        pageId: conversation.pageId,
        mid: sent.mid,
        text: body,
        sentByUserId: user.id,
        at: now,
      })
      if (created) {
        await bumpMessengerConversation(trx, { conversationId: id, direction: 'outbound', at: now, text: body, attachments: [] })
      }
    })
  } catch (err) {
    // Delivered to Messenger already; the echo webhook will still record it.
    console.error('[MessengerSend] Sent, but local record failed:', err instanceof Error ? err.message : 'unknown')
  }

  await markRead(id, user.agencyId, user.id).catch(() => {})
  revalidatePath('/inbox/messenger')
  return { ok: true }
}

async function markRead(conversationId: number, agencyId: number, userId: number) {
  await db('messenger_conversation_reads')
    .insert({ conversationId, userId, agencyId, lastReadAt: new Date() })
    .onConflict(['conversationId', 'userId'])
    .merge({ lastReadAt: new Date() })
}

/** Opening a conversation marks it read for THIS user only. Free action (no send, no spend). */
export async function markMessengerConversationRead(conversationId: number): Promise<{ ok: boolean }> {
  const user = await requireAgencyUser()
  const id = Number(conversationId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false }
  const owned = await db('messenger_conversations').where({ id, agencyId: user.agencyId }).first('id')
  if (!owned) return { ok: false }
  await markRead(id, user.agencyId, user.id)
  return { ok: true }
}
