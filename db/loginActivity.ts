import { db } from '@/config/db'

export type LoginActivity = {
  ip: string
  userAgent: string
  at: string
}

const MAX_ENTRIES = 10
const UA_MAX_LEN = 300

export async function recordLoginActivity(userId: number, ctx: { ip: string; userAgent: string }): Promise<void> {
  if (!userId) return

  const entry: LoginActivity = {
    ip: ctx.ip || 'unknown',
    userAgent: (ctx.userAgent || '').slice(0, UA_MAX_LEN),
    at: new Date().toISOString(),
  }

  await db.transaction(async (trx) => {
    const row = await trx('users_info').select('ips').where({ id: userId }).forUpdate().first()

    const existing: LoginActivity[] = Array.isArray(row?.ips) ? (row!.ips as LoginActivity[]) : []
    const nextIps = [entry, ...existing].slice(0, MAX_ENTRIES)
    const ipsJson = JSON.stringify(nextIps)

    await trx('users_info')
      .insert({ id: userId, ips: trx.raw('?::jsonb', [ipsJson]) })
      .onConflict('id')
      .merge({ ips: trx.raw('?::jsonb', [ipsJson]) })
  })
}

export async function getRecentLoginActivity(userId: number): Promise<LoginActivity[]> {
  if (!userId) return []
  const row = await db('users_info').select('ips').where({ id: userId }).first()
  const ips = row?.ips
  return Array.isArray(ips) ? (ips as LoginActivity[]).slice(0, MAX_ENTRIES) : []
}
