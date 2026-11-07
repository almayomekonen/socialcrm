import type { Knex } from 'knex'

/**
 * One row in owner_personal_reminder_events. Typed fields only: the table has no
 * text or JSON column, so reminder text cannot be copied into the audit trail.
 */
export type ReminderEvent = {
  agencyId: number
  userId?: number | null
  recipientId?: number | null
  reminderId?: number | null
  type: 'proposed' | 'scheduled' | 'discarded' | 'superseded' | 'rescheduled' | 'cancelled' | 'text_purged'
  actorKind: 'owner' | 'system' | 'settings' | 'keyword' | 'meta'
  actionId?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  /** An enum code, at most 40 characters. Never prose. */
  reason?: string | null
  versionAfter?: number | null
  remindAtBefore?: Date | null
  remindAtAfter?: Date | null
}

export async function insertReminderEvents(trx: Knex.Transaction, events: ReminderEvent[]): Promise<void> {
  if (events.length > 0) await trx('owner_personal_reminder_events').insert(events)
}
