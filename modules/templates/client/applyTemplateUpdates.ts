import type { Template } from '@/lib/whatsapp/templates/types'

/**
 * Merge a fresh (DB-only) template list into the store — the status-reconciliation
 * the poll performs. UPDATE-ONLY by id: it converges existing rows' status /
 * failureText and never adds or removes rows, so an un-reconciled optimistic
 * placeholder (negative temp id, absent from the server list) is left untouched.
 *
 * Returns the SAME array reference when nothing changed, so the poll doesn't cause
 * a re-render on every tick (mirrors the inbox's applyStatusesToMessages).
 */
export function applyTemplateUpdates(prev: Template[], incoming: Template[]): Template[] {
  if (incoming.length === 0) return prev
  const byId = new Map(incoming.map((t) => [t.id, t]))
  let changed = false
  const next = prev.map((t) => {
    const u = byId.get(t.id)
    if (!u || (u.status === t.status && u.failureText === t.failureText)) return t
    changed = true
    return { ...t, status: u.status, failureText: u.failureText }
  })
  return changed ? next : prev
}
