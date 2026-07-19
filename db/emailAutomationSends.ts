import { db } from '@/config/db'

export type ClaimRow = { automationKey: string; userId: number; agencyId: number; periodKey: string }

export async function claimSend(row: ClaimRow): Promise<boolean> {
  const inserted = await db('email_automation_sends')
    .insert({ ...row, status: 'pending' })
    .onConflict(['automationKey', 'userId', 'periodKey'])
    .ignore()
    .returning('id')
  return inserted.length > 0
}

export async function markSent(automationKey: string, userId: number, periodKey: string): Promise<void> {
  await db('email_automation_sends')
    .where({ automationKey, userId, periodKey })
    .update({ status: 'sent', updatedAt: db.fn.now() })
}

export async function releaseClaim(automationKey: string, userId: number, periodKey: string): Promise<void> {
  await db('email_automation_sends').where({ automationKey, userId, periodKey, status: 'pending' }).del()
}

// Progression of the educational journey: which educational emails have actually
// been DELIVERED (status 'sent') to this user. Only delivered emails advance the
// sequence — a claimed-but-unfinished ('pending') step is not counted, so it is
// retried rather than skipped. Returns the set of delivered educational keys.
export async function deliveredEducationalKeys(userId: number, educationalKeys: string[]): Promise<Set<string>> {
  if (educationalKeys.length === 0) return new Set()
  const rows = await db('email_automation_sends')
    .where({ userId })
    .where('status', 'sent')
    .whereIn('automationKey', educationalKeys)
    .select('automationKey')
  return new Set(rows.map((r) => r.automationKey as string))
}

// Global lifecycle cadence: has this user received ANY of the given lifecycle
// automations (status 'sent') on/after `sinceIso`? Used for the 7-day cooldown.
export async function hasRecentLifecycleSend(userId: number, lifecycleKeys: string[], sinceIso: string): Promise<boolean> {
  if (lifecycleKeys.length === 0) return false
  const row = await db('email_automation_sends')
    .where({ userId })
    .whereIn('status', ['pending', 'sent']) // a claimed-but-unfinalized send also holds the cooldown
    .whereIn('automationKey', lifecycleKeys)
    .where('createdAt', '>=', sinceIso)
    .first('id')
  return !!row
}
