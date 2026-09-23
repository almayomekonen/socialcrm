'use server'

import { after } from 'next/server'
import { db } from '@/config/db'
import { requireAgencyUser } from '@/lib/requireUser'
import { MESSENGER_TEXT_MAX, type MessengerSendFailure } from '@/lib/facebook/messenger/rules'
import { describeRichContent, validateRichContent } from '@/lib/facebook/messenger/structured'
import { asContent, getMessengerSavedReply } from '@/db/messengerSavedReplies'
import { sendMessengerMessage, sendMessengerText } from '@/lib/facebook/messenger/send'
import { sendMessengerSenderAction } from '@/lib/facebook/messenger/senderAction'
import {
  authorizeMessengerSend,
  failFromGraph,
  markMessengerRead,
  recordOutbound,
  resolveMessengerPeer,
} from './sendGuards'
import { listMessengerMessagePage } from './queries'
import type { MessengerMessage } from './types'

export type MessengerSendResult = { ok: true } | { ok: false; reason: MessengerSendFailure; detail?: string }

/**
 * Sending in a Messenger conversation.
 *
 * Every send — text or media — goes through `authorizeMessengerSend`, which is
 * the single place the entitlement, rollout gate, tenancy, 24-hour window, Page
 * grant and token are checked. See modules/messenger/sendGuards.ts for why that
 * is one function and not a copy per action.
 */

/** Reply with text inside the standard messaging window. */
export async function sendMessengerReply(conversationId: number, text: string): Promise<MessengerSendResult> {
  const body = typeof text === 'string' ? text.trim() : ''
  if (!body) return { ok: false, reason: 'empty' }
  if (body.length > MESSENGER_TEXT_MAX) return { ok: false, reason: 'too_long' }

  const guard = await authorizeMessengerSend(conversationId)
  if ('reason' in guard) return { ok: false, reason: guard.reason }
  const { ctx } = guard

  const sent = await sendMessengerText({
    pageId: ctx.pageId,
    pageAccessToken: ctx.pageAccessToken,
    psid: ctx.psid,
    text: body,
  })
  if ('error' in sent) return failFromGraph(sent.error, ctx)

  await recordOutbound(ctx, { mid: sent.mid, text: body, attachments: [] })
  return { ok: true }
}

/**
 * Show the customer a typing indicator while a rep composes.
 *
 * Deliberately fire-and-forget and never surfaced: a sender action carries no
 * content, and a failed one is not something a rep can or should act on. It
 * reuses the full authorization chain anyway — it is still a call made to a
 * customer on a Page's behalf, and "it's only a typing dot" is exactly how an
 * unscoped Meta call gets written.
 */
export async function sendMessengerTyping(conversationId: number, on: boolean): Promise<{ ok: boolean }> {
  try {
    const guard = await authorizeMessengerSend(conversationId)
    if ('reason' in guard) return { ok: false }
    const { ctx } = guard
    const result = await sendMessengerSenderAction({
      pageId: ctx.pageId,
      pageAccessToken: ctx.pageAccessToken,
      psid: ctx.psid,
      action: on ? 'typing_on' : 'typing_off',
    })
    return { ok: !('error' in result) }
  } catch {
    return { ok: false }
  }
}

/**
 * Send a saved reply — text, and whatever structure it carries (quick replies,
 * buttons, an attachment by URL).
 *
 * The client names the reply by ID ONLY. Its content is read from the row on
 * the server, so a rep cannot craft an arbitrary structured payload through
 * this endpoint, and the buttons a customer sees are always ones an admin
 * wrote.
 *
 * `text` is an optional override for the body — the rep edits the snippet in
 * the composer before sending it, which is the whole reason a saved reply is a
 * starting point and not a macro.
 */
export async function sendMessengerSavedReply(
  conversationId: number,
  savedReplyId: number,
  text?: string,
): Promise<MessengerSendResult> {
  const guard = await authorizeMessengerSend(conversationId)
  if ('reason' in guard) return { ok: false, reason: guard.reason }
  const { ctx } = guard

  const reply = await getMessengerSavedReply(ctx.agencyId, Number(savedReplyId))
  if (!reply) return { ok: false, reason: 'not_found' }

  const body = (typeof text === 'string' ? text : reply.body).trim()
  if (body.length > MESSENGER_TEXT_MAX) return { ok: false, reason: 'too_long' }

  const content = asContent(reply)
  // Re-validated at send: a reply stored before a limit changed, or edited
  // directly in the database, must not reach Meta as an opaque refusal.
  const check = validateRichContent(content)
  if ('error' in check) return { ok: false, reason: 'invalid_file', detail: check.error }
  // A button template REQUIRES text; without it there is nothing to attach
  // buttons to and Meta refuses the whole message.
  if (!body && content.buttons?.length) {
    return { ok: false, reason: 'empty', detail: 'לתשובה עם כפתורים צריך גם טקסט' }
  }
  if (!body && !content.attachment) return { ok: false, reason: 'empty' }

  const sent = await sendMessengerMessage({
    pageId: ctx.pageId,
    pageAccessToken: ctx.pageAccessToken,
    psid: ctx.psid,
    text: body,
    content,
  })
  if ('error' in sent) return failFromGraph(sent.error, ctx)

  await recordOutbound(ctx, {
    mid: sent.mid,
    text: describeRichContent(body, content),
    // Recorded without a URL for a Meta-hosted asset; an attachment sent BY URL
    // is one we can legitimately show, because we are the ones who supplied it.
    attachments: content.attachment ? [{ type: content.attachment.type, url: content.attachment.url }] : [],
  })
  return { ok: true }
}

/**
 * Older messages in a conversation, for the "load earlier" control.
 *
 * A read, so it takes `requireAgencyUser` rather than `requireProductAccess`:
 * scrolling back through history an agency already owns is not billable work,
 * and an expired subscription must not erase the record of what was said.
 * Ownership is still checked — the conversation must belong to the caller's
 * agency before a single row is read.
 */
export async function loadOlderMessengerMessages(
  conversationId: number,
  beforeId: number,
): Promise<{ ok: true; messages: MessengerMessage[]; hasMore: boolean } | { ok: false }> {
  const user = await requireAgencyUser()
  const id = Number(conversationId)
  const cursor = Number(beforeId)
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(cursor) || cursor <= 0) return { ok: false }
  const owned = await db('messenger_conversations').where({ id, agencyId: user.agencyId }).first('id')
  if (!owned) return { ok: false }
  const page = await listMessengerMessagePage(user.agencyId, id, { beforeId: cursor })
  return { ok: true, messages: page.messages, hasMore: page.hasMore }
}

/**
 * Opening a conversation marks it read for THIS user only. Free action (no send,
 * no spend).
 *
 * It also tells Meta the message was SEEN, which is what puts the read
 * indicator on the customer's side — the same signal they get from any other
 * Messenger client. Fire-and-forget and never surfaced: a failed sender action
 * is not something a rep can act on, and it must never make "open a
 * conversation" fail. Skipped outside the 24-hour window, where Meta would
 * refuse it anyway.
 */
export async function markMessengerConversationRead(conversationId: number): Promise<{ ok: boolean }> {
  const user = await requireAgencyUser()
  const id = Number(conversationId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false }
  const owned = await db('messenger_conversations').where({ id, agencyId: user.agencyId }).first('id')
  if (!owned) return { ok: false }
  await markMessengerRead(id, user.agencyId, user.id)

  after(async () => {
    try {
      const peer = await resolveMessengerPeer(user.agencyId, id)
      if (!peer) return
      await sendMessengerSenderAction({ ...peer, action: 'mark_seen' })
    } catch {
      // Display nicety on the customer's side only.
    }
  })
  return { ok: true }
}
