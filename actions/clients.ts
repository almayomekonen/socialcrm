'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { createHash } from 'crypto'
import { getAgencyId } from '@/db/agencies'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { track, trackFirstRealLeadOnce } from '@/lib/analytics/track'
import { isMobileRequest } from '@/lib/device'
import { mapImportRows } from '@/lib/leads/importMapping'
import * as XLSX from 'xlsx'
import { requireBasicCrmAccess, requireProductAccess } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { assertLeadQuota, QuotaExceededError, getEffectiveLeadPlan, withAgencyQuotaLock } from '@/lib/quota'
import type { QuotaErrorResult } from '@/lib/quota'
import { scheduleLeadIntelWarm } from '@/lib/ai/scheduleWarm'
import { emitAutomationEvent } from '@/lib/automations/emit'
import { emitLeadStatusChanged } from '@/lib/automations/statusChanged'
import { notifyEvent } from '@/lib/notifications/emit'
import { emitLeadCreated } from '@/lib/notifications/emitLeadCreated'
import { leadDisplayName } from '@/lib/notifications/leadName'
import { createOriginForUpsert } from '@/lib/leads/createOrigin'
import { type DeleteManyLeadsResult, type BlockedLead, type LeadBlockReason } from '@/lib/leads/deleteResult'
import { filePathsForLeads, removeUnreferencedObjects } from '@/lib/storage/cleanup'

export type { DeleteManyLeadsResult } from '@/lib/leads/deleteResult'

export type DeleteLeadResult =
  | { success: true }
  | { error: true; reason: 'no_permission' | 'not_found' }
  | { error: true; reason: 'has_billing'; block: LeadBlockReason }

export type AddLeadsResult =
  /**
   * `firstId` is the id of the first row actually inserted, so the caller can
   * open a REAL lead straight after an import instead of dropping the user on a
   * table. Undefined when nothing was inserted (all duplicates).
   */
  | { success: true; inserted: number; firstId?: number }
  | (QuotaErrorResult & { wouldInsert: number })

/**
 * How a bulk insert reached us. Carried on `leads_imported.props.format`, which
 * already existed — this is a new VALUE, deliberately not a new event, so the
 * import funnel stays one number across every entry point.
 */
export type LeadImportFormat = 'excel' | 'csv' | 'paste'

const CLIENT_WRITABLE_LEAD_FIELDS = new Set<string>([
  'firstName',
  'lastName',
  'idNum',
  'idNumDate',
  'birthDate',
  'gender',
  'familyStatus',
  'familyId',
  'passportNum',
  'licenseNum',
  'phone',
  'secPhone',
  'email',
  'leadSource',
  'handlerId',
  'userId',
  'status',
  'lead',
  'details',
  'rank',
])

function pickLeadFields<T extends Record<string, any>>(data: T): Partial<T> {
  const out: Partial<T> = {}
  if (!data || typeof data !== 'object') return out
  for (const key of Object.keys(data) as (keyof T)[]) {
    if (CLIENT_WRITABLE_LEAD_FIELDS.has(key as string)) out[key] = data[key]
  }
  return out
}

function isLeadTrue(val: unknown): boolean {
  return val === true || val === 'true'
}

async function hardDeleteSalesForClients(trx: import('knex').Knex.Transaction, clientIds: number[], agencyId: number) {
  if (clientIds.length === 0) return
  const saleRows = await trx('sales').whereIn('clientId', clientIds).andWhere({ agencyId }).select('id')
  const saleIds: number[] = saleRows.map((r: any) => Number(r.id))
  if (saleIds.length === 0) return

  await trx('sale_users').whereIn('saleId', saleIds).del()

  await trx('users')
    .whereRaw('"favSaleIds" && ?::integer[]', [saleIds])
    .update({
      favSaleIds: trx.raw(`ARRAY(SELECT UNNEST("favSaleIds") EXCEPT SELECT UNNEST(?::integer[]))`, [saleIds]),
    })

  await trx('sales').whereIn('id', saleIds).del()
}

/** A FK RESTRICT/violation Postgres error — used only to fail safe, never to surface raw. */
function isFkViolation(err: any): boolean {
  return err?.code === '23503' || err?.code === '23001'
}

function leadName(r: any): string | null {
  const full = (r?.name as string) || [r?.firstName, r?.lastName].filter(Boolean).join(' ')
  return full || null
}

/**
 * Detect leads blocked from deletion by a billing FK (ON DELETE RESTRICT).
 * Returns leadId → most significant reason (invoices > financial_events > profile).
 * Scoping by leadId is sufficient — the ids passed in are already agency+permission scoped.
 * Does NOT touch billing data; read-only existence checks.
 */
async function findBillingBlocks(trx: any, leadIds: number[]): Promise<Map<number, LeadBlockReason>> {
  const map = new Map<number, LeadBlockReason>()
  if (leadIds.length === 0) return map
  const [profiles, events, invoices] = await Promise.all([
    trx('bill_billing_profiles').whereIn('leadId', leadIds).distinct('leadId'),
    trx('bill_financial_events').whereIn('leadId', leadIds).distinct('leadId'),
    trx('bill_invoices').whereIn('leadId', leadIds).distinct('leadId'),
  ])
  // Last write wins → priority: billing_profile < financial_events < invoices.
  for (const r of profiles) map.set(Number(r.leadId), 'billing_profile')
  for (const r of events) map.set(Number(r.leadId), 'financial_events')
  for (const r of invoices) map.set(Number(r.leadId), 'invoices')
  return map
}

export async function deleteLead(clientId): Promise<DeleteLeadResult> {
  const user = await requireProductAccess()
  const { gotPermIds } = await getPerms(user)

  let filePaths: string[] = []
  try {
    const result = await db.transaction(async (trx) => {
      const scopeQ = trx('clients').where({ id: clientId, agencyId: user.agencyId })
      if (!isAdmin(user.role)) scopeQ.whereIn('userId', gotPermIds)
      const scoped = await scopeQ.first('id')

      if (!scoped) {
        const exists = await trx('clients').where({ id: clientId, agencyId: user.agencyId }).first('id')
        return { error: true, reason: exists ? 'no_permission' : 'not_found' } as const
      }

      // Block on billing dependency BEFORE deleting — never hit the RESTRICT FK.
      const block = (await findBillingBlocks(trx, [Number(scoped.id)])).get(Number(scoped.id))
      if (block) return { error: true, reason: 'has_billing', block } as const

      // Read before the cascade removes the rows; used only once this commits.
      filePaths = await filePathsForLeads(trx, user.agencyId, [Number(scoped.id)])
      await hardDeleteSalesForClients(trx, [Number(scoped.id)], user.agencyId)
      await trx('clients').where({ id: clientId, agencyId: user.agencyId }).del()
      return { success: true } as const
    })

    if ('success' in result) {
      await removeUnreferencedObjects(user.agencyId, filePaths)
      revalidatePath('/leads')
    }
    return result
  } catch (err: any) {
    // Defense in depth: an unknown RESTRICT FK must never reach the UI as a raw error.
    if (isFkViolation(err)) return { error: true, reason: 'has_billing', block: 'billing_profile' }
    throw err
  }
}

export async function deleteManyLeads(ids: number[], leads: boolean = true): Promise<DeleteManyLeadsResult> {
  const user = await requireProductAccess()
  if (!Array.isArray(ids) || ids.length === 0) return { deletedCount: 0, blockedCount: 0, blockedLeads: [], reason: null }

  const { gotPermIds } = await getPerms(user)

  let filePaths: string[] = []
  try {
    const result = await db.transaction(async (trx): Promise<DeleteManyLeadsResult> => {
      const inScopeQ = trx('clients').whereIn('id', ids).andWhere({ agencyId: user.agencyId, lead: leads })
      if (!isAdmin(user.role)) inScopeQ.whereIn('userId', gotPermIds)
      const inScopeRows = await inScopeQ.select('id', 'name', 'firstName', 'lastName')
      const inScopeIds: number[] = inScopeRows.map((r: any) => Number(r.id))
      if (inScopeIds.length === 0) return { deletedCount: 0, blockedCount: 0, blockedLeads: [], reason: null }

      // Partition: billing-blocked leads are left untouched; the rest are deleted.
      const blocks = await findBillingBlocks(trx, inScopeIds)
      const deletableIds = inScopeIds.filter((id) => !blocks.has(id))

      if (deletableIds.length > 0) {
        // Read before the cascade removes the rows; used only once this commits.
        filePaths = await filePathsForLeads(trx, user.agencyId, deletableIds)
        await hardDeleteSalesForClients(trx, deletableIds, user.agencyId)
        const deleteQ = trx('clients').whereIn('id', deletableIds).andWhere({ agencyId: user.agencyId, lead: leads })
        if (!isAdmin(user.role)) deleteQ.whereIn('userId', gotPermIds)
        await deleteQ.del()
      }

      const blockedLeads: BlockedLead[] = inScopeRows
        .filter((r: any) => blocks.has(Number(r.id)))
        .map((r: any) => ({ id: Number(r.id), name: leadName(r), reason: blocks.get(Number(r.id))! }))

      const reasons = new Set(blockedLeads.map((b) => b.reason))
      const reason = blockedLeads.length === 0 ? null : reasons.size === 1 ? [...reasons][0] : 'mixed'

      return { deletedCount: deletableIds.length, blockedCount: blockedLeads.length, blockedLeads, reason }
    })

    if (result.deletedCount > 0) {
      await removeUnreferencedObjects(user.agencyId, filePaths)
      revalidatePath('/leads')
      revalidatePath('/clients')
    }
    return result
  } catch (err: any) {
    // Unknown RESTRICT FK slipped past the pre-check — fail safe, delete nothing, never throw raw.
    if (isFkViolation(err)) return { deletedCount: 0, blockedCount: ids.length, blockedLeads: [], reason: 'mixed' }
    throw err
  }
}

/**
 * The batch's identity: a stable digest of WHICH leads moved.
 *
 * Pure and order-independent (ids are sorted before hashing), so it satisfies the
 * collapse-key purity rules — no clock, no actor — while still telling two
 * different batches to the same rep apart. A retry of the identical batch yields
 * the identical digest and therefore collapses rather than duplicating.
 */
function assignmentBatchId(sortedIds: number[]): string {
  return createHash('sha1').update(sortedIds.join(',')).digest('hex').slice(0, 12)
}

export type AssignLeadsResult = { assignedCount: number; skippedCount: number }

/**
 * Assign a chosen set of leads to a representative.
 *
 * THE SELECTED-LEADS FLOW, not an inference from who owns what. The admin ticks
 * the leads they mean and picks the recipient; exactly those rows move. This is
 * the bulk counterpart of `transferLeadToRep` and writes the same two columns,
 * so both paths agree on what "assigned" means:
 *
 *   userId    — ownership, the column every permission filter reads
 *   handlerId — the assignee notifications resolve against
 *   createdById — DELIBERATELY UNTOUCHED. Provenance is not ownership.
 *
 * Not to be confused with `transferSales`, which moves a departing rep's DEALS
 * from the user-management screen and does not change lead ownership at all.
 *
 * ADMIN-ONLY. Reassigning another rep's pipeline is an administrative act, and
 * the scoping below is tenant isolation, which the role test does not replace.
 */
export async function assignLeadsToRep(ids: number[], targetUserId: number): Promise<AssignLeadsResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) throw new Error('Forbidden')

  const leadIds = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  const target = Number(targetUserId)
  if (leadIds.length === 0 || !Number.isInteger(target) || target <= 0) {
    return { assignedCount: 0, skippedCount: 0 }
  }

  /**
   * The recipient must belong to the acting agency, checked BEFORE anything is
   * written. `lead.bulk_assigned` resolves its recipient from the payload rather
   * than from the database, so this is the check that keeps that rule
   * tenant-safe — see `resolveRecipients`.
   */
  const recipient = await db('users').where({ id: target, agencyId: user.agencyId }).first('id')
  if (!recipient) throw new Error('Forbidden')

  const result = await db.transaction(async (trx): Promise<AssignLeadsResult> => {
    // Agency-scoped, and locked so a concurrent edit cannot move a row out from
    // under the update between the read and the write.
    const inScope = await trx('clients')
      .whereIn('id', leadIds)
      .andWhere({ agencyId: user.agencyId })
      .forUpdate()
      .select('id', 'userId', 'handlerId')

    // Already on this rep in both columns — a double-click or retry is a no-op,
    // and must not produce a second notification. Same guard as transferLeadToRep.
    const toMove = inScope.filter((r: any) => Number(r.userId) !== target || Number(r.handlerId) !== target)
    if (toMove.length === 0) return { assignedCount: 0, skippedCount: leadIds.length }

    await trx('clients')
      .whereIn('id', toMove.map((r: any) => Number(r.id)))
      .andWhere({ agencyId: user.agencyId })
      .update({ userId: target, handlerId: target })

    /**
     * ONE notification for the whole action, not one per lead — forty rows in the
     * bell for one administrator action is the dump care-charter Law 6 forbids.
     *
     * The collapse key is per target recipient AND per assignment batch, the
     * batch being identified by a digest of the moved lead-id set. Two
     * consequences follow, and both are intended:
     *
     *   same recipient + same lead set  → same key, so a retry or a re-emission
     *                                     collapses onto the existing row rather
     *                                     than duplicating it
     *   same recipient + different set  → a different key, so a later assignment
     *                                     of OTHER leads is its own notification.
     *                                     It does not upgrade the earlier row —
     *                                     it is genuinely separate work.
     *
     * Emitted after the write, inside the transaction: if the assignment rolls
     * back, so does the notification.
     */
    const movedIds = toMove.map((r: any) => Number(r.id)).sort((a: number, b: number) => a - b)
    await notifyEvent(
      {
        type: 'lead.bulk_assigned',
        agencyId: user.agencyId,
        // The AGGREGATE entity: the set of leads now assigned to this rep,
        // addressed by the rep's id. `assignedUserId` below is the same value —
        // entity and recipient are one thing here, derived from one variable so
        // they cannot drift apart.
        entityType: 'lead_assignment',
        entityId: target,
        actorUserId: user.id,
        occurredAt: new Date(),
        payload: {
          assignedUserId: target,
          assignedCount: movedIds.length,
          assignmentBatchId: assignmentBatchId(movedIds),
        },
      },
      { trx },
    )

    return { assignedCount: toMove.length, skippedCount: leadIds.length - toMove.length }
  })

  if (result.assignedCount > 0) {
    revalidatePath('/leads')
    revalidatePath('/clients')
  }
  return result
}

export async function upsertLead(userId, data, clientId, revalidate = true, origin = 'manual') {
  /**
   * Same split as `updateLead`, because this action does both jobs. Editing an
   * existing lead is Tier 1 bookkeeping and stays open; CREATING one consumes
   * lead quota and escalates below, as does flipping a contact into a lead.
   *
   * Identity and tenant scoping are unchanged either way: every read and write
   * below is filtered by the session's agencyId.
   */
  let user = await requireBasicCrmAccess()
  const safeData = pickLeadFields(data ?? {})
  // ADR-010 ownership: this action is client-reachable, so origin is validated
  // — only the in-module CSV caller may claim 'import' (which suppresses
  // automations); anything else is coerced to 'manual'. A spoofed value can
  // never impersonate a webhook origin.
  const emitOrigin: 'manual' | 'import' = origin === 'import' ? 'import' : 'manual'

  try {
    let lead = null

    if (clientId) {
      // UPDATE branch: read-before-write so status/handler changes cannot silently
      // bypass the existing notification doors (updateLead / transferLeadToRep).
      // Jobs join this transaction — a rolled-back edit leaves no notification.
      lead = await db.transaction(async (trx) => {
        const existing = await trx('clients')
          .where({ id: clientId, agencyId: user.agencyId })
          .forUpdate()
          .first('id', 'lead', 'status', 'handlerId', 'userId', 'firstName', 'lastName')
        if (!existing) return null

        if (isLeadTrue(safeData.lead) && existing.lead === false) {
          // Contact becoming a lead: a new quota-consuming record, so this is
          // the paid branch even though the row already existed.
          user = await requireProductAccess()
          await assertLeadQuota(user.agencyId, 1, trx)
        }

        // createOrigin is immutable — never mass-assignable and never updated.
        delete (safeData as { createOrigin?: unknown }).createOrigin

        const prevHandlerId = existing.handlerId == null ? null : Number(existing.handlerId)
        const prevStatus = existing.status == null ? null : String(existing.status)

        const handlerProvided = Object.prototype.hasOwnProperty.call(safeData, 'handlerId')
        const nextHandlerRaw = handlerProvided ? safeData.handlerId : prevHandlerId
        const nextHandlerId =
          nextHandlerRaw == null || nextHandlerRaw === '' ? null : Number(nextHandlerRaw)
        const handlerChanged =
          handlerProvided &&
          nextHandlerId != null &&
          Number.isFinite(nextHandlerId) &&
          nextHandlerId > 0 &&
          nextHandlerId !== prevHandlerId

        const statusProvided = Object.prototype.hasOwnProperty.call(safeData, 'status')
        const nextStatus =
          statusProvided && typeof safeData.status === 'string' ? safeData.status : null
        const statusChanged = !!nextStatus && nextStatus !== prevStatus

        if (statusChanged) {
          const now = new Date()
          safeData.statusChangedAt = now
          safeData.lastActivityAt = now
        }

        const rows = await trx('clients')
          .where({ id: clientId, agencyId: user.agencyId })
          .update(safeData)
          .returning('*')
        const updated = rows[0]
        if (!updated) return null

        const name = leadDisplayName(updated)

        // Deterministic order when both change: assignment (new handler), then status.
        if (handlerChanged) {
          await notifyEvent(
            {
              type: 'lead.assigned',
              agencyId: user.agencyId,
              entityType: 'lead',
              entityId: Number(clientId),
              actorUserId: user.id,
              occurredAt: new Date(),
              payload: {
                leadName: name,
                assignedUserId: nextHandlerId,
              },
            },
            { trx },
          )
        }

        if (statusChanged) {
          await emitLeadStatusChanged({
            agencyId: user.agencyId,
            leadId: Number(clientId),
            newStatus: nextStatus,
            // Read above under SELECT ... FOR UPDATE inside this transaction, so
            // the transition log's origin is exact on this path.
            previousStatus: prevStatus,
            source: 'manual',
            occurredAt: safeData.statusChangedAt as Date,
            actorUserId: user.id,
            leadName: name,
            trx,
          })
        }

        return updated
      })
    } else {
      // CREATE branch: a brand new lead against quota. Explicitly Pro gated.
      user = await requireProductAccess()
      const agencyId = await getAgencyId()
      lead = await withAgencyQuotaLock(agencyId, async (trx) => {
        await assertLeadQuota(agencyId, 1, trx)
        const rows = await trx('clients')
          .insert({
            ...safeData,
            agencyId,
            createdById: userId,
            createOrigin: createOriginForUpsert(emitOrigin),
          })
          .returning('*')
        const created = rows[0]
        // Customer Automation Engine trigger (ADR-010): insert branch only,
        // actual leads only; the enqueue joins this quota-lock transaction.
        // emitAutomationEvent never throws — it cannot abort the insert.
        if (created && isLeadTrue(created.lead)) {
          await emitAutomationEvent(
            {
              trigger: 'lead_created',
              origin: emitOrigin,
              agencyId,
              leadId: created.id,
              occurredAt: new Date(),
              leadSource: created.leadSource ?? null,
            },
            { trx },
          )
          // Shared lead.created door — import origin is silent inside the helper.
          await emitLeadCreated(
            {
              agencyId,
              leadId: created.id,
              leadName: leadDisplayName(created),
              actorUserId: user.id,
              occurredAt: new Date(),
              origin: emitOrigin,
            },
            { trx },
          )
        }
        return created
      })

      /**
       * Every hand-typed lead, not just the workspace's first.
       * `first_manual_lead_created` (LeadsFirstRun) only ever fires once per
       * agency and only from the first-run screen, so a rep who adds leads by
       * hand every morning was producing no signal at all after day one.
       *
       * `emitOrigin` distinguishes manual entry from the other upsert callers,
       * so this can never be inflated by webhook or import writes. Post-commit,
       * inside after(), so analytics cannot delay or roll back a lead insert.
       */
      if (lead && emitOrigin === 'manual') {
        const createdAgencyId = agencyId
        // `surface` is resolved HERE, not inside after(): headers are unreadable
        // once the response has been sent. Derived from isMobileRequest() — the
        // same User-Agent check the layout gate uses — so mobile and desktop can
        // never be classified by two different rules, which is precisely the
        // viewport-vs-UA mismatch the funnel audit flagged.
        const surface = (await isMobileRequest()) ? 'mobile' : 'desktop'
        after(() =>
          track({
            agencyId: createdAgencyId,
            userId: user.id,
            event: 'lead_created_manual',
            props: { surface, origin: emitOrigin },
          }),
        )
        after(() => trackFirstRealLeadOnce(createdAgencyId, 'manual'))
      }
    }

    if (revalidate) revalidatePath('/leads')

    return lead
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return {
        error: 'quota_exceeded' as const,
        current: error.current,
        limit: error.limit,
        attempted: error.attempted,
      }
    }
    console.error(error)
    return { err: true, msg: 'שגיאה בשמירת לקוח' }
  }
}

// Lead lists are per-user (they are read with `where({ userId })`). Writes must
// be scoped to the caller's own rows, or any authenticated user can modify or
// delete another user's/tenant's list by id (client_lists has no agencyId).
const LIST_WRITABLE = ['title', 'clientIds'] as const

function pickListFields(data: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (data && typeof data === 'object') {
    for (const key of LIST_WRITABLE) {
      if (key in (data as Record<string, unknown>)) out[key] = (data as Record<string, unknown>)[key]
    }
  }
  return out
}

export async function upsertLeadList(_userId, data) {
  const user = await requireProductAccess()
  // Ignore the client-supplied userId; the owner is always the caller. Column
  // allowlist blocks mass-assignment of id/userId.
  const safe = pickListFields(data)
  if (data?.id) {
    const rows = await db('client_lists').where({ id: data.id, userId: user.id }).update(safe)
    if (!rows) throw new Error('Forbidden')
  } else {
    await db('client_lists').insert({ userId: user.id, ...safe })
  }

  revalidatePath('/leads')
}

export async function deleteLeadList(id) {
  const user = await requireProductAccess()
  await db('client_lists').where({ id, userId: user.id }).delete()

  revalidatePath('/leads')
}

export async function transferDealsToLead(fromClientId, toClientId) {
  const user = await requireProductAccess()
  const from = await db('clients').where({ id: fromClientId, agencyId: user.agencyId }).first()
  if (!from) throw new Error('Forbidden')
  const to = await db('clients').where({ id: toClientId, agencyId: user.agencyId }).first()
  if (!to) throw new Error('Forbidden')
  await db('sales').where('clientId', fromClientId).update({ clientId: toClientId })
  revalidatePath('/leads')
}

/**
 * Transfer ownership ("בעל ליד") to another נציג.
 *
 * Persists BOTH `userId` and `handlerId` to the same assignee. The transfer UI
 * only wrote `userId` historically, but notification recipients
 * (`handler_or_admin`) and the product's "whose work is this" field are
 * `handlerId` — leaving it stale would notify the previous handler (or nobody)
 * after a transfer. Create/import paths already set both to the same user; this
 * keeps transfer aligned with that invariant.
 *
 * `lead.assigned` is enqueued in the SAME transaction as the UPDATE so a
 * rolled-back transfer leaves no notification job.
 */
export async function transferLeadToRep(clientId, userId) {
  const user = await requireProductAccess()
  const agencyId = user.agencyId
  const leadId = Number(clientId)
  const newUserId = Number(userId)
  if (!Number.isInteger(leadId) || leadId <= 0) throw new Error('Forbidden')
  if (!Number.isInteger(newUserId) || newUserId <= 0) throw new Error('Forbidden')

  await db.transaction(async (trx) => {
    const existing = await trx('clients')
      .where({ id: leadId, agencyId })
      .forUpdate()
      .first('id', 'userId', 'handlerId', 'firstName', 'lastName')
    if (!existing) throw new Error('Forbidden')

    const prevUserId = existing.userId == null ? null : Number(existing.userId)
    const prevHandlerId = existing.handlerId == null ? null : Number(existing.handlerId)
    // Same owner + same handler already — a confirm double-click / retry is a no-op.
    if (prevUserId === newUserId && prevHandlerId === newUserId) return

    await trx('clients').where({ id: leadId, agencyId }).update({ userId: newUserId, handlerId: newUserId })

    // Notify the NEW assignee via handler_or_admin (reads handlerId after persist).
    // Actor === assignee is dropped in planNotification (§6.3). Previous handler
    // is no longer on the row, so they are not resolved.
    await notifyEvent(
      {
        type: 'lead.assigned',
        agencyId,
        entityType: 'lead',
        entityId: leadId,
        actorUserId: user.id,
        occurredAt: new Date(),
        payload: {
          leadName: leadDisplayName(existing),
          assignedUserId: newUserId,
        },
      },
      { trx },
    )
  })

  revalidatePath('/leads')
}

/**
 * TIER 1. Search is how a customer finds their own records. It reads and spends
 * nothing, and the ratified policy names search, filter and sort as basic CRM.
 * Tenant scoping, the permission filter and the query semantics below are
 * unchanged.
 */
async function searchBase(val, isLead) {
  const user = await requireBasicCrmAccess()
  const terms = val.split(' ').filter((term) => term)

  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
  const query = db('clients').select('id', 'details', 'firstName', 'lastName', 'idNum', 'userId').where('agencyId', agencyId)

  /**
   * The SAME permission rule the lead table, `hasAnyLeads`, `getLeadsByRep` and
   * `getLeadById` already apply — this was the one lead read that omitted it.
   *
   * Two consequences of the omission, both real: a rep could autocomplete a
   * colleague's lead, and the rows carry `idNum` — which `details` also embeds,
   * being generated as `firstName || ' ' || lastName || ' (' || idNum || ')'`.
   * So a national ID was reachable for leads the caller holds no permission on.
   * Filtering at the query means an inaccessible lead is never a row, so no
   * field of it can be returned. Admins are unconstrained, exactly as elsewhere.
   */
  if (!isAdmin(user.role)) {
    const { gotPermIds } = await getPerms(user)
    query.whereIn('userId', gotPermIds)
  }

  if (plan === 'free') query.where('overQuota', false)
  if (isLead === true) {
    query.where('lead', true)
  } else {
    // deals search — include both leads and clients so newly created leads are findable
    query.whereIn('lead', [true, false])
  }

  terms.forEach((term) => {
    query.where((builder) => {
      builder.where('details', 'ilike', `%${term}%`).orWhere(db.raw('"idNum"::text'), 'ilike', `%${term}%`)
    })
  })

  query.orderByRaw(
    `
    CASE
      WHEN "idNum"::text ILIKE ? THEN 1
      WHEN "details" ILIKE ? THEN 2
      WHEN "firstName" ILIKE ? THEN 3
      WHEN "lastName" ILIKE ? THEN 4
      WHEN "idNum"::text ILIKE ? THEN 5
      ELSE 6
    END, "details"
  `,
    [`${val}%`, `${val}%`, `${val}%`, `${val}%`, `%${val}%`],
  )

  const res = await query.limit(50)
  return res
}

export async function searchContacts(val) {
  return searchBase(val, false)
}

export async function searchLeads(val) {
  return searchBase(val, true)
}

export async function getLeadById(clientId) {
  // Previously unauthenticated and unscoped: any caller could read any lead by
  // id, across tenants, including idNum (national ID). Scoped to the caller's
  // agency and — for non-admins — to leads they hold permission on, matching
  // the access rule updateLead already enforces.
  // Read of existing data: viewing, not spending. Tenant scoping below is unchanged.
  const user = await requireBasicCrmAccess()
  const id = Number(clientId)
  if (!Number.isInteger(id)) return null

  const query = db('clients').where({ id, agencyId: user.agencyId })
  if (!isAdmin(user.role)) {
    const { gotPermIds } = await getPerms(user)
    query.whereIn('userId', gotPermIds)
  }

  return (await query.first('id', 'firstName', 'lastName', 'idNum', 'createdById', 'userId')) ?? null
}

export async function updateLead(data) {
  /**
   * BASIC CRM by default. Editing a lead the customer already owns — status,
   * rank, phone, notes — rearranges stored data and spends nothing, so an
   * expired subscription does not block it. Identity and tenant scoping are
   * unchanged: the same session-derived agencyId scopes every query below, the
   * same role/permission filter applies, and `pickLeadFields` still limits the
   * write to the server-side allowlist.
   */
  let user = await requireBasicCrmAccess()
  const { id } = data ?? {}
  const safeData: Record<string, any> = pickLeadFields(data ?? {})

  if (isLeadTrue(safeData.lead)) {
    const existing = await db('clients').where({ id, agencyId: user.agencyId }).first('lead')
    if (existing && existing.lead === false) {
      /**
       * ESCALATION — the one paid branch in this action. Flipping a contact to
       * a lead consumes lead quota, which is the Pro resource, so this path and
       * only this path requires product access. Re-guarding here (rather than
       * at the top) is what lets the free edits above stay open.
       */
      user = await requireProductAccess()
      await assertLeadQuota(user.agencyId, 1)
    }
  }

  if ('status' in safeData) {
    safeData.statusChangedAt = new Date()
    safeData.lastActivityAt = new Date()
  }
  safeData.updatedAt = new Date()

  const { gotPermIds } = await getPerms(user)

  // Transition-log origin. `.returning('*')` below yields the row AFTER the
  // update, so the status the lead is moving OUT of has to be read first. Scoped
  // identically to the write (same agencyId, same isAdmin branch, same
  // gotPermIds) and reusing the permission set already resolved above — so this
  // adds one SELECT on status writes only, and changes no authorization
  // semantics. Unlocked and outside any transaction on this path; see the race
  // window documented in db/leadStatusTransitions.ts.
  let previousStatus: string | null = null
  if ('status' in safeData) {
    const prevQuery = db('clients').where({ id, agencyId: user.agencyId })
    if (!isAdmin(user.role)) prevQuery.whereIn('userId', gotPermIds)
    const prevRow = await prevQuery.first('status')
    previousStatus = (prevRow?.status as string | null) ?? null
  }

  const query = db('clients').where({ id, agencyId: user.agencyId })
  if (!isAdmin(user.role)) query.whereIn('userId', gotPermIds)
  const res = await query
    .update(safeData)
    .returning('*')
    .catch((err) => {
      console.error('updateLead failed', err)
      throw err
    })

  if (!res || res.length === 0) {
    throw new Error('No rows updated')
  }

  revalidatePath('/leads')
  scheduleLeadIntelWarm(id, { reason: 'lead.update' })

  // Customer Automation Engine trigger (ADR-010): one of THREE status-writing
  // surfaces, all routed through the same emitter so they cannot drift
  // (lib/automations/statusChanged.ts). occurredAt = the row's own
  // statusChangedAt, so the eventKey anchors on the business moment.
  if ('status' in safeData && typeof safeData.status === 'string' && safeData.status) {
    await emitLeadStatusChanged({
      agencyId: user.agencyId,
      leadId: Number(id),
      newStatus: safeData.status,
      // Read above, before the update. A no-op status re-save records no
      // transition (buildTransitionInput drops it).
      previousStatus,
      source: 'manual',
      occurredAt: safeData.statusChangedAt as Date,
      // The authenticated caller, not a client-supplied id — so the
      // self-notification drop cannot be bypassed. The updated row is already in
      // hand, so the name costs no extra query.
      actorUserId: user.id,
      leadName: leadDisplayName(res[0]),
    })
  }

  return res[0]
}

export async function getLeadByIdNum(idNum: string) {
  // Read of existing data: viewing, not spending. Tenant scoping below is unchanged.
  await requireBasicCrmAccess()
  const agencyId = await getAgencyId()

  const res = await db('clients')
    .where({ idNum: idNum.padStart(9, '0'), agencyId })
    .select('name')
    .first()
  return res
}

export async function uploadLeadData(file) {
  await requireProductAccess()
  const fileStream = file.stream()
  const chunks = []

  for await (const chunk of fileStream) {
    chunks.push(chunk)
  }

  const rawBuffer = Buffer.concat(chunks)
  const workbook = XLSX.read(rawBuffer, { type: 'buffer' })
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheetName]
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

  const headers = (jsonData[0] as unknown[]) ?? []
  const dataRows = jsonData.slice(1) as unknown[][]

  /**
   * Mapping moved to `lib/leads/importMapping.ts`. The rules it replaced
   * required a national ID on every row, never mapped a phone number, and
   * discarded a row for any unrecognised column — which made the target user's
   * own lead list impossible to import. See that module's header.
   */
  return mapImportRows(headers, dataRows)
}

export async function addLeads(leads, format: LeadImportFormat = 'excel'): Promise<AddLeadsResult> {
  await requireProductAccess()
  const { id: userId } = await getUser()
  const agencyId = await getAgencyId()
  const safeLeads: any[] = Array.isArray(leads) ? leads.map((lead) => pickLeadFields(lead ?? {})) : []
  const formatLeads: any[] = safeLeads.map((lead) => {
    return {
      handlerId: userId,
      userId,
      lead: true,
      ...lead,
      /**
       * `clients.firstName` and `clients.lastName` are both NOT NULL with no
       * default. Every lead list this product's users actually have — a pasted
       * column of numbers, a sheet with "שם פרטי, טלפון" — carries no surname,
       * so without these two lines the insert dies with a not-null violation
       * and the whole import fails. Found by the value-loop DB test; a mocked
       * `db` cannot see a column constraint.
       *
       * Empty string, never a placeholder name: the UI already composes a
       * display name from what exists, and inventing "לא ידוע" would put a word
       * in the customer's list that they never typed.
       */
      firstName: lead.firstName ?? '',
      lastName: lead.lastName ?? '',
      createdById: userId,
      status: 'new',
      agencyId,
      createOrigin: 'import',
    }
  })

  /**
   * DEDUPE. Previously this was a single `whereIn('idNum', …)` over every row.
   * Now that a national ID is optional, that array can be all-undefined, and
   * knex throws "Undefined binding(s) detected" — which would have made every
   * phone-only import fail outright. Each key is queried only over the rows
   * that actually carry it, and both queries are skipped when empty.
   *
   * Phone is deduped agency-scoped (a phone is only "already a lead" inside the
   * tenant that owns it); the id check keeps its original global scope so the
   * behaviour of existing ID-bearing files is unchanged.
   */
  const idNums: string[] = formatLeads.map((l) => l.idNum).filter(Boolean)
  const phones: string[] = formatLeads.map((l) => l.phone).filter(Boolean)

  const existingIdNums = idNums.length ? await db('clients').select('idNum').whereIn('idNum', idNums) : []
  const existingPhones = phones.length
    ? await db('clients').select('phone').where({ agencyId }).whereIn('phone', phones)
    : []

  const takenIds = new Set(existingIdNums.map((r: any) => r.idNum))
  const takenPhones = new Set(existingPhones.map((r: any) => r.phone))
  // Also collapse duplicates WITHIN the same file/paste, which the old
  // implementation let through and inserted twice.
  const seenIds = new Set<string>()
  const seenPhones = new Set<string>()

  const newLeads = formatLeads.filter((lead) => {
    if (lead.idNum) {
      if (takenIds.has(lead.idNum) || seenIds.has(lead.idNum)) return false
      seenIds.add(lead.idNum)
      return true
    }
    if (lead.phone) {
      if (takenPhones.has(lead.phone) || seenPhones.has(lead.phone)) return false
      seenPhones.add(lead.phone)
      return true
    }
    return false
  })

  if (!newLeads.length) return { success: true, inserted: 0 }

  let firstId: number | undefined
  try {
    await withAgencyQuotaLock(agencyId, async (trx) => {
      await assertLeadQuota(agencyId, newLeads.length, trx)
      const rows = await trx('clients').insert(newLeads).returning('id')
      firstId = Number((Array.isArray(rows) ? rows[0] : undefined)?.id ?? rows?.[0]) || undefined
    })
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return {
        error: 'quota_exceeded' as const,
        current: error.current,
        limit: error.limit,
        attempted: leads.length,
        wouldInsert: newLeads.length,
      }
    }
    throw error
  }

  revalidatePath('/leads')

  /**
   * `product.md` §7 calls the Excel import the product's first success moment —
   * "within 60 seconds they can see all their leads organized in one place" —
   * and until now it emitted nothing at all, so the single highest-value
   * onboarding act in SocialCRM was invisible in the funnel.
   *
   * Emitted only on a genuine insert (quota rejections and all-duplicate files
   * return before this line), after the transaction has committed. `after()`
   * keeps the analytics write off the response path, and track() never throws.
   */
  after(() => track({ agencyId, userId, event: 'leads_imported', props: { count: newLeads.length, format } }))
  after(() => trackFirstRealLeadOnce(agencyId, 'import'))

  return { success: true, inserted: newLeads.length, firstId }
}

export async function getLeadDeals(clientId) {
  // Same class as getLeadById: scope the read to the caller's agency so a lead
  // id from another tenant cannot return that tenant's deals.
  // Read of existing data: viewing, not spending. Tenant scoping below is unchanged.
  const user = await requireBasicCrmAccess()
  const id = Number(clientId)
  if (!Number.isInteger(id)) return []
  return db('_sales').where({ clientId: id, agencyId: user.agencyId })
}

function parseCSVLine(line: string, delim: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

export async function importLeadsFromCsv(file: File) {
  const user = await requireProductAccess()
  const { id: userId } = await getUser()
  const agencyId = await getAgencyId()
  // ── DEBUG: agency scope trace ──────────────────────────────────────────
  console.log('[importLeadsFromCsv][debug] user.agencyId:', user.agencyId)
  console.log('[importLeadsFromCsv][debug] user.id:', user.id, 'user.email:', user.email)
  console.log('[importLeadsFromCsv][debug] getUser().id:', userId)
  console.log('[importLeadsFromCsv][debug] getAgencyId():', agencyId)
  // ───────────────────────────────────────────────────────────────────────

  const chunks: Buffer[] = []
  for await (const chunk of (file as any).stream()) chunks.push(chunk)
  const buf = Buffer.concat(chunks)
  const nullRatio = buf.subarray(0, 200).filter((b) => b === 0).length / 200
  const text = nullRatio > 0.2 ? buf.toString('utf16le') : buf.toString('utf-8')

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) return { inserted: 0, updated: 0, unchanged: 0, invalid: 0 }

  const delim = lines[0].includes('\t') ? '\t' : ','
  const headers = parseCSVLine(lines[0], delim).map((h) =>
    h
      .toLowerCase()
      .replace(/^["']|["']$/g, '')
      .replace(/_/g, ' '),
  )
  const idx = (keywords: string[]) => headers.findIndex((h) => keywords.some((k) => h.includes(k)))
  const nameIdx = idx(['שם', 'name', 'full name'])
  const phoneIdx = idx(['טלפון', 'נייד', 'phone', 'mobile', 'tel'])
  const emailIdx = idx(['מייל', 'אימייל', 'email', 'mail'])
  // ── DEBUG: CSV header parsing trace ────────────────────────────────────
  console.log('[importLeadsFromCsv][debug] rawHeaderLine:', JSON.stringify(lines[0]))
  console.log('[importLeadsFromCsv][debug] delimiter:', JSON.stringify(delim))
  console.log('[importLeadsFromCsv][debug] headers:', headers)
  console.log('[importLeadsFromCsv][debug] phoneIdx:', phoneIdx, '→', phoneIdx >= 0 ? headers[phoneIdx] : '(not found)')
  console.log('[importLeadsFromCsv][debug] emailIdx:', emailIdx, '→', emailIdx >= 0 ? headers[emailIdx] : '(not found)')
  console.log('[importLeadsFromCsv][debug] nameIdx:', nameIdx, '→', nameIdx >= 0 ? headers[nameIdx] : '(not found)')
  // ───────────────────────────────────────────────────────────────────────
  if (phoneIdx === -1) console.log('[importLeadsFromCsv] headers:', headers)

  const valid: { firstName: string; lastName: string; phone: string | null; email: string | null }[] = []
  let invalid = 0

  for (const line of lines.slice(1)) {
    const cols = parseCSVLine(line, delim).map((c) => c.replace(/^["']|["']$/g, ''))

    const rawPhone = phoneIdx >= 0 ? cols[phoneIdx] : ''
    const rawEmail = emailIdx >= 0 ? cols[emailIdx] : ''
    const rawName = nameIdx >= 0 ? cols[nameIdx] : ''

    if (!rawPhone && !rawEmail) {
      invalid++
      continue
    }

    // normalize phone → 972XXXXXXXXX
    let phone: string | null = null
    if (rawPhone) {
      const digits = rawPhone.replace(/\D/g, '')
      if (digits.length >= 9) {
        phone = digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')
      }
    }

    const email = rawEmail ? rawEmail.toLowerCase() : null

    if (!phone && !email) {
      invalid++
      continue
    }

    const parts = rawName.trim().split(/\s+/)
    valid.push({ firstName: parts[0] || '', lastName: parts.slice(1).join(' '), phone, email })
  }

  let inserted = 0
  let updated = 0
  let unchanged = 0

  for (const lead of valid) {
    try {
      const exists = await db('clients')
        .where({ agencyId })
        .where((q) => {
          if (lead.phone) q.orWhere('phone', lead.phone)
          if (lead.email) q.orWhere('email', lead.email)
        })
        .first()

      if (!exists) {
        // origin 'import': imported leads never trigger automations (ADR-004 —
        // this is the CSV-reuses-upsertLead footgun, neutralized explicitly).
        const res = await upsertLead(userId, { ...lead, lead: true, status: 'new', userId, handlerId: userId }, null, false, 'import')
        if (res && (res as any).error === 'quota_exceeded') {
          if (inserted > 0 || updated > 0) revalidatePath('/leads')
          return {
            error: 'quota_exceeded' as const,
            current: (res as any).current,
            limit: (res as any).limit,
            attempted: valid.length,
            wouldInsert: valid.length - inserted - updated - unchanged,
            inserted,
            updated,
            unchanged,
            invalid,
          }
        }
        inserted++
        continue
      }

      // fill only empty fields — never overwrite existing values
      const patch: Record<string, string> = {}
      if (!exists.firstName && lead.firstName) patch.firstName = lead.firstName
      if (!exists.lastName && lead.lastName) patch.lastName = lead.lastName
      if (!exists.phone && lead.phone) patch.phone = lead.phone
      if (!exists.email && lead.email) patch.email = lead.email

      if (Object.keys(patch).length === 0) {
        unchanged++
      } else {
        await db('clients').where({ id: exists.id }).update(patch)
        updated++
      }
    } catch {
      unchanged++
    }
  }

  if (inserted > 0 || updated > 0) revalidatePath('/leads')

  // Same first-success-moment signal as the Excel path, distinguished by
  // `format` so the two import routes can be compared. Only a real insert
  // counts: a file that only updated existing rows delivered no new leads.
  if (inserted > 0) {
    const importAgencyId = agencyId
    after(() => track({ agencyId: importAgencyId, userId, event: 'leads_imported', props: { count: inserted, format: 'csv' } }))
    after(() => trackFirstRealLeadOnce(importAgencyId, 'import'))
  }

  return { inserted, updated, unchanged, invalid }
}

export async function fetchLeadsSince(lastSeenAt: string) {
  // Read of existing data: viewing, not spending. Tenant scoping below is unchanged.
  const user = await requireBasicCrmAccess()
  const agencyId = user.agencyId
  const plan = await getEffectiveLeadPlan(agencyId)
  const query = db('clients')
    .where({ 'clients.agencyId': agencyId, lead: true })
    .whereRaw('"clients"."updatedAt"::timestamptz > ?::timestamptz', [lastSeenAt])
    .leftJoin({ handler: 'users' }, 'clients.handlerId', 'handler.id')
    .leftJoin({ creator: 'users' }, 'clients.userId', 'creator.id')
    .select('clients.*', 'handler.name as handlerName', 'creator.name as userName')
    .orderBy('clients.updatedAt', 'asc')
    .limit(100)
  if (plan === 'free') query.where('clients.overQuota', false)
  if (!isAdmin(user.role)) {
    const { gotPermIds } = await getPerms(user)
    query.whereIn('clients.userId', gotPermIds)
  }
  return query
}
