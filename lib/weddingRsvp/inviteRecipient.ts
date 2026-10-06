import { db } from '@/config/db'
import { upsertLead } from '@/actions/clients'
import { attachConversationToLead, findOrCreateConversation } from '@/db/inboxConversations'
import { findClientsByPhoneCore } from '@/lib/whatsapp/matchLeadByPhone'
import { findConversationForWaId, listAgencyPhoneNumberIds } from '@/lib/weddingRsvp/inviteData'

export type InviteRecipient = { leadId: number; leadCreated: boolean; conversationId: number; conversationCreated: boolean }
export type InviteRecipientResult = { ok: true; recipient: InviteRecipient } | { ok: false; error: string }

/**
 * Find — or, for a brand-new number, create — the guest's Lead and WhatsApp
 * conversation, without duplicating either. Runs inside the caller's invite lock.
 *
 *  Lead: the conversation's lead, else the single agency lead with that phone
 *        (same phone-core match the webhook uses), else a new one through the
 *        normal `upsertLead` create path (session, quota, field whitelist).
 *        Two leads with the phone → refuse: never guess.
 *  Conversation: the existing one for the wa_id, else one on the agency's single
 *        connected number, keyed on the 972… wa_id exactly as the webhook stores
 *        Meta's `from` — so the guest's reply lands in the same conversation.
 */
export async function ensureInviteRecipient(args: {
  agencyId: number
  userId: number
  waId: string
  firstName: string
  lastName: string
}): Promise<InviteRecipientResult> {
  const existing = await findConversationForWaId(args.agencyId, args.waId)

  let leadId = existing?.leadId ?? null
  let leadCreated = false
  if (leadId == null) {
    const matches = await findClientsByPhoneCore(args.agencyId, args.waId)
    if (matches.length > 1) return { ok: false, error: 'ambiguous-lead' }
    if (matches.length === 1) {
      leadId = matches[0].id
    } else {
      // status/userId/handlerId explicit, as in modules/messenger/leadActions.ts: the
      // column defaults ('true', NULL) hide a ליד from every status tab and rep filter.
      const created = (await upsertLead(
        args.userId,
        {
          firstName: args.firstName,
          lastName: args.lastName,
          phone: args.waId,
          lead: true,
          status: 'new',
          userId: args.userId,
          handlerId: args.userId,
          leadSource: 'wedding_invite',
        },
        null,
        false,
        'manual',
      )) as { id?: unknown } | null
      const id = Number(created?.id)
      if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'lead-create-failed' }
      leadId = id
      leadCreated = true
    }
  }

  if (existing) {
    if (existing.leadId == null) await attachConversationToLead(db, { conversationId: existing.id, agencyId: args.agencyId, leadId })
    return { ok: true, recipient: { leadId, leadCreated, conversationId: existing.id, conversationCreated: false } }
  }

  const phoneNumberIds = await listAgencyPhoneNumberIds(args.agencyId)
  if (phoneNumberIds.length !== 1) return { ok: false, error: phoneNumberIds.length ? 'ambiguous-connection' : 'no-connection' }

  const conversationId = await db.transaction((trx) =>
    findOrCreateConversation(trx, {
      agencyId: args.agencyId,
      leadId,
      channel: 'whatsapp',
      businessPhoneNumberId: phoneNumberIds[0],
      customerWaId: args.waId,
      customerName: `${args.firstName} ${args.lastName}`.trim(),
    }),
  )
  return { ok: true, recipient: { leadId, leadCreated, conversationId, conversationCreated: true } }
}
