import type { Knex } from 'knex'
import { businessDayBounds } from '@/lib/today/time'
import { REMINDER_MAX_PER_RECIPIENT_DAY, REMINDER_MAX_SCHEDULED_PER_USER } from '@/lib/reminders/limits'

/**
 * Shared steps for the owner-driven reminder transitions (T4 cancel, T5 create,
 * T6 reschedule).
 *
 * LOCK ORDER (architecture v1.2 §3, v1.6.1): the recipient row (L1), then the
 * reminder row (L2). `recipientId` is read WITHOUT a lock first, so no
 * reminder lock is held while the recipient lock is awaited. The trigger makes
 * `recipientId` immutable, so the relationship cannot change between the two
 * reads; it is still re-checked.
 */

const T = 'owner_personal_reminders'

export type LockedReminder = {
  id: number
  agencyId: number
  userId: number
  recipientId: number
  status: string
  version: number
  remindAt: Date
  anchorMessageTs: number
  createdByActionId: string | null
  proposalActionId: string | null
}

const COLUMNS = ['id', 'agencyId', 'userId', 'recipientId', 'status', 'version', 'remindAt', 'anchorMessageTs', 'createdByActionId', 'proposalActionId']

function toLocked(r: Record<string, unknown>): LockedReminder {
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    userId: Number(r.userId),
    recipientId: Number(r.recipientId),
    status: String(r.status),
    version: Number(r.version),
    remindAt: new Date(r.remindAt as string | Date),
    anchorMessageTs: Number(r.anchorMessageTs),
    createdByActionId: (r.createdByActionId as string | null) ?? null,
    proposalActionId: (r.proposalActionId as string | null) ?? null,
  }
}

/** The reminder, locked in L1 → L2 order, only if it belongs to this owner (agency AND user). */
export async function lockOwnedReminder(
  trx: Knex.Transaction,
  reminderId: number,
  owner: { agencyId: number; userId: number },
): Promise<LockedReminder | null> {
  const where = { id: reminderId, agencyId: owner.agencyId, userId: owner.userId }
  const peek = (await trx(T).where(where).first('recipientId')) as { recipientId: string | number } | undefined
  if (!peek) return null
  await trx('owner_whatsapp_recipients').where({ id: peek.recipientId }).forUpdate().first('id')
  const row = (await trx(T).where(where).forUpdate().first(COLUMNS)) as Record<string, unknown> | undefined
  if (!row || Number(row.recipientId) !== Number(peek.recipientId)) return null
  return toLocked(row)
}

/** Read without locking: verification and reconciliation probes only. */
export async function readOwnedReminder(
  db: Knex | Knex.Transaction,
  reminderId: number,
  agencyId: number,
): Promise<LockedReminder | null> {
  const row = (await db(T).where({ id: reminderId, agencyId }).first(COLUMNS)) as Record<string, unknown> | undefined
  return row ? toLocked(row) : null
}

/**
 * The approved creation/reschedule limits, counted under the recipient lock so
 * two concurrent approvals cannot both pass at the edge. `excludeId` is the row
 * being changed itself.
 */
export async function limitBreached(
  trx: Knex.Transaction,
  r: Pick<LockedReminder, 'id' | 'agencyId' | 'userId' | 'recipientId'>,
  remindAtMs: number,
): Promise<'scheduled_limit' | 'daily_limit' | null> {
  const live = (await trx(T)
    .where({ agencyId: r.agencyId, userId: r.userId })
    .whereIn('status', ['scheduled', 'claimed'])
    .whereNot({ id: r.id })
    .count<{ n: string }[]>('* as n')) as { n: string }[]
  if (Number(live[0].n) >= REMINDER_MAX_SCHEDULED_PER_USER) return 'scheduled_limit'

  const { dayStart, dayEnd } = businessDayBounds(remindAtMs)
  const start = new Date(dayStart)
  const end = new Date(dayEnd)
  const day = (await trx(T)
    .where({ recipientId: r.recipientId })
    .whereNot({ id: r.id })
    .andWhere((q) =>
      q
        .where((a) => a.whereIn('status', ['scheduled', 'claimed']).andWhere('remindAt', '>=', start).andWhere('remindAt', '<', end))
        .orWhere((b) =>
          b.whereIn('status', ['dispatching', 'sent', 'unknown']).andWhere('dispatchedAt', '>=', start).andWhere('dispatchedAt', '<', end),
        ),
    )
    .count<{ n: string }[]>('* as n')) as { n: string }[]
  return Number(day[0].n) >= REMINDER_MAX_PER_RECIPIENT_DAY ? 'daily_limit' : null
}
