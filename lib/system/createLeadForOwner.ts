import 'server-only'
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { insertLeadSystem } from '@/lib/system/insertLeadSystem'
import { assertLeadQuota, QUOTA_LOCK_NAMESPACE, QuotaExceededError, withAgencyQuotaLock } from '@/lib/quota'
import { emitAutomationEvent } from '@/lib/automations/emit'
import { emitLeadCreated } from '@/lib/notifications/emitLeadCreated'
import { leadDisplayName } from '@/lib/notifications/leadName'
import { trackFirstRealLeadOnce } from '@/lib/analytics/track'
import { normalizeEmail, normalizePhone } from '@/lib/leads/normalizeContact'

/**
 * A lead the business owner asked for by hand, from a signed, server-verified
 * context that has no browser session (the WhatsApp assistant, after the owner
 * approved a card). The same CREATE contract as `upsertLead`'s create branch
 * (actions/clients.ts), which needs a session and so cannot be called here:
 *
 *   - under the agency quota lock, `assertLeadQuota` REFUSES past the free limit
 *     (a hand-made lead is never silently hidden as `overQuota`);
 *   - `createOrigin: 'manual'`, the owner as owner, handler and creator;
 *   - the `lead_created` automation trigger and the `lead.created` notification,
 *     both with origin `manual`, inside the same transaction as the insert.
 *
 * IDEMPOTENT by `leadSource` (unique across the table): the caller passes a key
 * derived from its own approved action, so a retried or crashed execution finds
 * the lead it already made instead of making a second one.
 *
 * NO DUPLICATES: a phone or email already on a lead of this agency refuses
 * (`contact_taken`) rather than creating a second person; the database's own
 * unique indexes on (agencyId, phone) and (agencyId, email) back it.
 */

export type OwnerLeadInput = {
  agencyId: number
  userId: number
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  /** Unique, derived from the caller's approved action. */
  leadSource: string
}

export type OwnerLeadResult =
  | { ok: true; leadId: number; created: boolean }
  | { ok: false; reason: 'quota_exceeded' | 'contact_taken' | 'insert_failed' }

/** The agency's leads that already carry this phone (its 9 national digits, as stored in any format) or email. */
export async function leadsWithContact(executor: Knex | Knex.Transaction, agencyId: number, contact: { phone: string | null; email: string | null }): Promise<number[]> {
  const core = normalizePhone(contact.phone)?.slice(-9) ?? null
  const email = normalizeEmail(contact.email)
  if (!core && !email) return []
  const rows = (await executor('clients')
    .where({ agencyId })
    .where((b) => {
      if (core) {
        b.orWhereRaw(`regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') LIKE ?`, [`%${core}`])
        b.orWhereRaw(`regexp_replace(coalesce("secPhone", ''), '[^0-9]', '', 'g') LIKE ?`, [`%${core}`])
      }
      if (email) b.orWhereRaw('lower("email") = ?', [email])
    })
    .orderBy('id')
    .limit(10)
    .select('id')) as { id: number }[]
  return rows.map((r) => Number(r.id))
}

/**
 * The same, inside the CALLER'S transaction: the agency quota lock is taken on
 * it and held until it ends, and the insert and its lead-created doors commit
 * or roll back with whatever else the caller writes (`create_quote` writes the
 * new customer's quote in the same transaction, so a refused quote leaves no
 * lead behind). A failed insert aborts the transaction: the caller must end it
 * and may then ask `afterFailedInsert` why.
 */
export async function createLeadForOwnerIn(trx: Knex.Transaction, input: OwnerLeadInput): Promise<OwnerLeadResult> {
  const { agencyId, userId, leadSource } = input
  const phone = normalizePhone(input.phone)
  const email = normalizeEmail(input.email)
  await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [agencyId, QUOTA_LOCK_NAMESPACE])
  const own = (await trx('clients').where({ agencyId, leadSource }).first('id')) as { id: number } | undefined
  if (own) return { ok: true, leadId: Number(own.id), created: false }
  if ((await leadsWithContact(trx, agencyId, { phone, email })).length) return { ok: false, reason: 'contact_taken' }
  try {
    await assertLeadQuota(agencyId, 1, trx)
  } catch (err) {
    if (err instanceof QuotaExceededError) return { ok: false, reason: 'quota_exceeded' }
    throw err
  }
  const created = await insertLeadSystem(
    {
      agencyId,
      userId,
      handlerId: userId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone,
      email,
      idNum: null,
      leadSource,
      overQuota: false,
      lead: true,
      status: 'new',
      createOrigin: 'manual',
    },
    { executor: trx },
  )
  // The insert aborted this transaction: nothing more may run in it.
  if (!created) return { ok: false, reason: 'insert_failed' }
  const occurredAt = new Date()
  await emitAutomationEvent({ trigger: 'lead_created', origin: 'manual', agencyId, leadId: created.id, occurredAt, leadSource }, { trx })
  await emitLeadCreated({ agencyId, leadId: created.id, leadName: leadDisplayName(created), actorUserId: userId, occurredAt, origin: 'manual' }, { trx })
  return { ok: true, leadId: Number(created.id), created: true }
}

/**
 * After an insert failed and its transaction ended: a concurrent run of the same
 * action made the lead (`own`), a writer outside the lock (a webhook) took the
 * phone or email (`contact_taken`), or neither (`failed`).
 */
export async function afterFailedInsert(input: OwnerLeadInput): Promise<'own' | 'contact_taken' | 'failed'> {
  if (await db('clients').where({ agencyId: input.agencyId, leadSource: input.leadSource }).first('id')) return 'own'
  return (await leadsWithContact(db, input.agencyId, input)).length ? 'contact_taken' : 'failed'
}

/** Once a new lead is committed. Never throws. */
export const noteLeadCreated = (agencyId: number) => trackFirstRealLeadOnce(agencyId, 'manual').catch(() => undefined)

/** The lead alone, in a transaction of its own. */
export async function createLeadForOwner(input: OwnerLeadInput): Promise<OwnerLeadResult> {
  const result = await withAgencyQuotaLock(input.agencyId, (trx) => createLeadForOwnerIn(trx, input))
  if (result.ok === false && result.reason === 'insert_failed') {
    const why = await afterFailedInsert(input)
    if (why === 'own') {
      const row = (await db('clients').where({ agencyId: input.agencyId, leadSource: input.leadSource }).first('id')) as { id: number }
      return { ok: true, leadId: Number(row.id), created: false }
    }
    if (why === 'contact_taken') return { ok: false, reason: 'contact_taken' }
  }
  if (result.ok && result.created) await noteLeadCreated(input.agencyId)
  return result
}
