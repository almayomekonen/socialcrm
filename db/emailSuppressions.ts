import { db } from '@/config/db'

export async function isSuppressed(userId: number): Promise<boolean> {
  const row = await db('email_suppressions').where({ userId, scope: 'all' }).first('id')
  return !!row
}

export async function addSuppression(userId: number): Promise<void> {
  await db('email_suppressions').insert({ userId, scope: 'all' }).onConflict(['userId', 'scope']).ignore()
}
