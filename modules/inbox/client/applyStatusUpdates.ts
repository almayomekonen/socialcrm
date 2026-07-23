import type { LeadWhatsappMessage, LeadWhatsappMessageStatus } from '@/db/inboxMessages'

/**
 * Merge a status projection into the open thread.
 *
 * Returns the SAME array reference when nothing changed. The sync response
 * always carries the last 60 statuses, so without this the thread would
 * re-render on every poll.
 */
export function applyStatusesToMessages(
  prev: LeadWhatsappMessage[],
  updates: LeadWhatsappMessageStatus[],
): LeadWhatsappMessage[] {
  if (updates.length === 0) return prev
  const byId = new Map(updates.map((u) => [u.id, u]))
  let changed = false
  const next = prev.map((m) => {
    const u = byId.get(m.id)
    if (!u || (u.status === m.status && u.failureText === m.failureText)) return m
    changed = true
    return { ...m, status: u.status, failureText: u.failureText }
  })
  return changed ? next : prev
}
