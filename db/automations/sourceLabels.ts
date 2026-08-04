import { db } from '@/config/db'
import type { Source } from '@/lib/automations/catalog/types'

/**
 * The name the BUSINESS gives a source, kept apart from the name its provider
 * reports.
 *
 * A connector refreshes its own labels from every delivery — Contact Form 7
 * updates a form's title, another renames a channel — so storing
 * the customer's wording in the same place would lose it on the next webhook.
 * This overlay is applied on read instead, which means:
 *
 *   · it works for EVERY connector, including ones whose sources live in their
 *     own tables and never touch `automation_sources`;
 *   · no connector had to change to support renaming;
 *   · the provider's own label is never destroyed, so clearing a custom name
 *     restores the real one.
 */

export async function customLabels(agencyId: number, connectionId: string): Promise<Record<string, string>> {
  const rows = (await db('automation_source_labels').select('sourceId', 'label').where({ agencyId, connectionId })) as {
    sourceId: string
    label: string
  }[]
  const out: Record<string, string> = {}
  for (const row of rows) out[row.sourceId] = row.label
  return out
}

/** Sources as the customer named them. Falls back to the provider's label. */
export async function applyCustomLabels(agencyId: number, connectionId: string, sources: Source[]): Promise<Source[]> {
  if (sources.length === 0) return sources
  const custom = await customLabels(agencyId, connectionId)
  if (Object.keys(custom).length === 0) return sources
  return sources.map((s) => (custom[s.id] ? { ...s, label: custom[s.id] } : s))
}

/** An empty label CLEARS the override rather than storing a blank name. */
export async function setSourceLabel(agencyId: number, connectionId: string, sourceId: string, label: string): Promise<void> {
  const trimmed = label.trim()
  if (!trimmed) {
    await db('automation_source_labels').where({ agencyId, connectionId, sourceId }).del()
    return
  }
  await db('automation_source_labels')
    .insert({ agencyId, connectionId, sourceId, label: trimmed })
    .onConflict(['agencyId', 'connectionId', 'sourceId'])
    .merge({ label: trimmed, updatedAt: db.fn.now() })
}
