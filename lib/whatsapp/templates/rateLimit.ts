import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * Server-side per-agency create throttle (RFC §13). Enforced in the create/retry
 * actions, before any Graph call — protects the WABA's quality rating from a burst
 * of submissions and stays under Meta's own daily create caps.
 *
 * `conn` is injectable for tests.
 */
export const TEMPLATE_CREATE_LIMIT = { max: 10, windowMs: 24 * 60 * 60 * 1000 } as const

export const RATE_LIMIT_MESSAGE = 'יצרתם היום את מכסת ההודעות המוכנות. נסו שוב מחר.'

export async function isCreateRateLimited(agencyId: number, conn: Knex = db): Promise<boolean> {
  const since = new Date(Date.now() - TEMPLATE_CREATE_LIMIT.windowMs)
  const [row] = await conn('whatsapp_templates')
    .where({ agencyId })
    .where('createdAt', '>', since)
    .count<{ n: string | number }[]>({ n: '*' })
  return Number(row?.n ?? 0) >= TEMPLATE_CREATE_LIMIT.max
}
