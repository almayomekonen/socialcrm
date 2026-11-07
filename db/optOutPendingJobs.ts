import type { Knex } from 'knex'
import { toCustomerPhoneE164 } from '@/lib/whatsapp/optOut/phone'

export const OPTED_OUT_SKIP_REASON = 'opted_out'

/**
 * The raw `customerWaId` spellings a conversation can carry for one E.164
 * number: Meta's wa_id (digits), a '+'-prefixed copy, or, for an Israeli
 * number, the local 0XXXXXXXXX a lead's typed phone becomes when a rep opens a
 * conversation first (lib/inbox/whatsappOutboundTarget.ts). Every candidate is
 * re-checked with `toCustomerPhoneE164`, so a near match is never touched.
 */
function rawSpellings(phoneE164: string): string[] {
  const digits = phoneE164.slice(1)
  const out = [digits, phoneE164]
  if (digits.startsWith('972')) out.push(`0${digits.slice(3)}`)
  return out
}

/**
 * When an opt-out is saved, end the customer's PENDING automated WhatsApp
 * replies (IRE first contact, qualify and questionnaire turns, no-response
 * warning and close: every row of `auto_response_jobs`) as `skipped/opted_out`.
 *
 * Scope is exact: this business, WhatsApp conversations whose customer number
 * normalises to this E.164. Nothing else is touched.
 *
 *  - Only `pending` rows. A `processing` row belongs to a running worker; it is
 *    left alone and its send is refused by the gate, which waits on the
 *    opt-out lock the caller holds.
 *  - `auto_response_jobs` holds automated work only; rep sends never queue.
 *  - A claim racing this UPDATE either takes the row first (then the gate
 *    blocks it) or finds it skipped.
 *
 * Automation-engine jobs (`automation_jobs`) are deliberately NOT cancelled
 * here: they are keyed by lead and automation, not by number; whether a job
 * sends WhatsApp at all, and to which recipient, is resolved from the
 * definition and the lead when it runs. The gate blocks them at send time and
 * records a terminal `skipped/opted_out`.
 */
export async function skipPendingAutomatedRepliesForCustomer(
  trx: Knex.Transaction,
  agencyId: number,
  phoneE164: string,
): Promise<number> {
  const candidates = (await trx('inbox_conversations')
    .where({ agencyId, channel: 'whatsapp' })
    .whereIn('customerWaId', rawSpellings(phoneE164))
    .select('id', 'customerWaId')) as { id: number | string; customerWaId: string | null }[]
  const conversationIds = candidates
    .filter((c) => toCustomerPhoneE164(c.customerWaId) === phoneE164)
    .map((c) => Number(c.id))
  if (conversationIds.length === 0) return 0

  const n = await trx('auto_response_jobs')
    .where({ agencyId, status: 'pending' })
    .whereIn('conversationId', conversationIds)
    .update({
      status: 'skipped',
      skipReason: OPTED_OUT_SKIP_REASON,
      lockedAt: null,
      lockedBy: null,
      updatedAt: trx.fn.now(),
    })
  return Number(n) || 0
}
