/**
 * Worker presence lookup — P3.0, spec §7.2 / §21.2.
 *
 * Replaces the P1 `p1Presence` placeholder that classified everyone OFFLINE.
 * The feed poll remains the only WRITER of `user_presence`; this module only
 * READs, once per worker pass, and hands planNotification a pure
 * `(userId) => Presence` function built from that snapshot.
 *
 * Fail-safe: a user with no row, or a pair that was not loaded, classifies
 * OFFLINE via `classifyPresence(null, now)` — the same rule the feed uses.
 */

import {
  loadPresenceBatch,
} from '@/db/notifications/presence'
import type { RecipientContext } from '@/db/notifications/recipients'
import { classifyPresence, type PresenceRow } from './presence'
import type { Presence } from './types'

/**
 * Every user the pass might notify — handlers of the claimed leads, plus the
 * admins of the claimed agencies. Deduplicated so twenty jobs about one lead
 * still cost one presence row.
 */
export function collectPresenceTargets(context: RecipientContext): { agencyId: number; userId: number }[] {
  const seen = new Set<string>()
  const out: { agencyId: number; userId: number }[] = []

  const add = (agencyId: number, userId: number) => {
    const key = `${agencyId}:${userId}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ agencyId, userId })
  }

  for (const [agencyId, admins] of context.adminsByAgency) {
    for (const userId of admins) add(agencyId, userId)
  }
  for (const [key, handlerId] of context.handlerByLead) {
    if (handlerId == null) continue
    const agencyId = Number(key.split(':')[0])
    if (!Number.isFinite(agencyId)) continue
    add(agencyId, handlerId)
  }

  return out
}

/**
 * Pure: turn a batch of presence rows into the `(userId) => Presence` plan.ts
 * expects. Missing ids classify OFFLINE — never guessed ONLINE.
 */
export function presenceLookupFromRows(
  rows: ReadonlyMap<number, PresenceRow>,
  now: Date,
): (userId: number) => Presence {
  return (userId: number) => classifyPresence(rows.get(userId) ?? null, now)
}

/**
 * One batched read for the pass, then a pure lookup. Empty targets ⇒ every
 * recipient classifies OFFLINE without touching the database.
 */
export async function buildPresenceLookup(
  context: RecipientContext,
  now: Date = new Date(),
): Promise<(userId: number) => Presence> {
  const targets = collectPresenceTargets(context)
  const rows = await loadPresenceBatch(targets)
  return presenceLookupFromRows(rows, now)
}
