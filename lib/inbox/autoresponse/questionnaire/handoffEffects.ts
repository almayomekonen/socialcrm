/**
 * Handing a finished (or abandoned) questionnaire to a person.
 *
 * Three things, all of them existing mechanisms rather than new ones:
 *   1. the conversation is linked to a ליד, creating one if it was still an
 *      unlinked contact — the answers have to hang off something a rep can open;
 *   2. the summary is added as a note on the lead's own WhatsApp task, which is
 *      the surface the lead page already renders;
 *   3. the notification engine is told, through the same outbox every other
 *      event uses, so it inherits the existing gating, recipients and dedup.
 *
 * Nothing here assigns the lead to a different rep. Assignment writes
 * `clients.userId`/`handlerId`, which drive visibility and permissions, and
 * quietly moving a lead between people is not this feature's business. The lead
 * keeps the owner it already has — for WhatsApp leads, whoever connected the
 * number.
 */
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { attachConversationToLead } from '@/db/inboxConversations'
import { createLeadFromWhatsappWebhook } from '@/lib/system/createLeadFromWhatsappWebhook'
import { parseWhatsappLead } from '@/lib/adapters/whatsappLead'
import { notifyEvent } from '@/lib/notifications/emit'

/** The title the WhatsApp webhook gives the lead's first task. */
const WEBHOOK_TASK_TITLE = 'ליד חדש מוואטסאפ'
/** Used only when that task is gone: completed, or the lead came from elsewhere. */
const FALLBACK_TASK_TITLE = 'לחזור לליד אחרי שאלון וואטסאפ'
const NOTE_AUTHOR = 'שאלון וואטסאפ'

/**
 * Make sure the conversation has a ליד, without inventing one for a chat that
 * never became a lead on its own.
 *
 * Called only when a questionnaire has actually produced something: someone
 * answered questions and is now waiting for a person. Creation goes through the
 * same webhook helper the inbound path uses, keyed by the conversation's first
 * inbound message id, so running it twice returns the same lead instead of a
 * second one.
 */
export async function ensureLeadForConversation(args: {
  agencyId: number
  conversationId: number
}): Promise<number | null> {
  const conv = await db('inbox_conversations')
    .where({ id: args.conversationId, agencyId: args.agencyId })
    .first('id', 'leadId', 'customerWaId', 'customerName', 'businessPhoneNumberId', 'isPersonal')
  if (!conv) return null
  if (conv.isPersonal === true) return null
  const existing = conv.leadId != null && Number(conv.leadId) > 0 ? Number(conv.leadId) : null
  if (existing) return existing

  const firstInbound = await db('inbox_messages')
    .where({ conversationId: args.conversationId, agencyId: args.agencyId, direction: 'inbound' })
    .orderBy('sequence', 'asc')
    .first('externalId')
  const messageId = (firstInbound?.externalId as string | null) ?? `conv:${args.conversationId}`

  const connection = await db('whatsapp_connections')
    .where({ phone_number_id: conv.businessPhoneNumberId, agency_id: args.agencyId })
    .first('user_id')
  if (!connection) return null

  const { firstName, lastName, phone } = parseWhatsappLead(
    String(conv.customerWaId ?? ''),
    (conv.customerName as string | null) ?? null,
  )
  const lead = await createLeadFromWhatsappWebhook({
    firstName,
    lastName,
    phone,
    messageId,
    agencyId: args.agencyId,
    userId: Number(connection.user_id),
  })
  if (!lead) return null
  const leadId = Number(lead.id)
  await attachConversationToLead(db, { conversationId: args.conversationId, agencyId: args.agencyId, leadId })
  return leadId
}

/**
 * Put the summary where the rep already looks: as a note on the lead's open
 * WhatsApp task. Appending to that task rather than creating a second one is
 * deliberate — one lead that arrived once is one piece of work, and two tasks
 * saying nearly the same thing is the pile this product exists to prevent.
 *
 * Tenant scope comes from the caller, which resolved the lead from its own
 * agency-scoped conversation; `tasks` has no agency column of its own.
 */
export async function recordSummaryTaskNote(
  trx: Knex.Transaction,
  args: { agencyId: number; leadId: number; summary: string },
): Promise<void> {
  const lead = await trx('clients')
    .where({ id: args.leadId, agencyId: args.agencyId })
    .first('id', 'userId', 'handlerId')
  if (!lead) return

  const note = JSON.stringify([
    { userName: NOTE_AUTHOR, content: args.summary, createdAt: new Date().toISOString() },
  ])

  const open = await trx('tasks')
    .where({ clientId: args.leadId, completed: false, title: WEBHOOK_TASK_TITLE })
    .orderBy('id', 'desc')
    .first('id')

  if (open) {
    await trx('tasks')
      .where({ id: open.id })
      .update({ notes: trx.raw(`COALESCE(notes, '[]'::jsonb) || ?::jsonb`, [note]), updatedAt: trx.fn.now() })
    return
  }

  await trx('tasks').insert({
    clientId: args.leadId,
    title: FALLBACK_TASK_TITLE,
    userId: (lead.handlerId as number | null) ?? (lead.userId as number | null) ?? null,
    dueDate: new Date().toISOString().split('T')[0],
    tasks: JSON.stringify([]),
    notes: trx.raw(`?::jsonb`, [note]),
    files: [],
  } as Record<string, unknown>)
}

/**
 * Tell the notification engine. It owns everything after this: whether the
 * feature is on for this agency, who the recipients are, which channels they
 * get, and absorbing a duplicate emission.
 */
export async function notifyQuestionnaireHandoff(
  trx: Knex.Transaction,
  args: { agencyId: number; leadId: number; leadName: string | null; complete: boolean },
): Promise<void> {
  await notifyEvent(
    {
      type: 'lead.questionnaire_handoff',
      agencyId: args.agencyId,
      entityType: 'lead',
      entityId: args.leadId,
      actorUserId: null,
      occurredAt: new Date(),
      payload: { leadName: args.leadName, complete: args.complete, provider: 'whatsapp' },
    },
    { trx },
  )
}
