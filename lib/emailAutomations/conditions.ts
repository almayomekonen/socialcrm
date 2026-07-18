import { db } from '@/config/db'
import type { Recipient } from './types'

const INACTIVE_DAYS = 14

/**
 * TEMPORARY signal (see spec §13/§17). "Inactive" is derived from the login trail
 * `users_info.ips[0].at` because no dedicated activity field exists yet. When a
 * first-class `lastActivityAt` is introduced, swap ONLY this function to read it —
 * the automation, registry, template, and dispatcher do not change.
 */
export async function isInactiveOwner(recipient: Recipient): Promise<boolean> {
  const row = await db('users_info').where({ id: recipient.userId }).first('ips')
  const ips = (row?.ips as Array<{ at?: string }> | null) ?? []
  if (!Array.isArray(ips) || ips.length === 0) return true
  const lastAt = ips[0]?.at
  if (!lastAt) return true
  return Date.parse(lastAt) < Date.now() - INACTIVE_DAYS * 86_400_000
}
