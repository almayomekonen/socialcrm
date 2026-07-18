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
