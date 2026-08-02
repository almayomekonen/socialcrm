'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { getDefinition } from '@/db/automations/definitions'
import { listActivityForAutomation } from '@/db/automations/activity'

/**
 * Activity log reader for the modal. Agency-scoped twice over: the definition
 * is re-read under the caller's agencyId before its rows are returned.
 */

export type ActivityRowDto = {
  id: number
  leadId: number
  leadName: string | null
  kind: 'sent' | 'would_send' | 'skipped' | 'failed'
  mode: 'live' | 'log'
  skipReason: string | null
  subject: string | null
  deliveryState: string | null
  occurredAt: string
}

export type ListActivityResult = { ok: true; rows: ActivityRowDto[] } | { ok: false; reason: string }

export async function listActivityForAutomationAction(automationId: number): Promise<ListActivityResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }

  const definition = await getDefinition(user.agencyId, automationId)
  if (!definition) return { ok: false, reason: 'not_found' }

  const rows = (await listActivityForAutomation(user.agencyId, automationId, 100)) as Array<Record<string, unknown>>
  return {
    ok: true,
    rows: rows.map((r) => ({
      id: Number(r.id),
      leadId: Number(r.leadId),
      leadName: (r.leadName as string) ?? null,
      kind: r.kind as ActivityRowDto['kind'],
      mode: r.mode as ActivityRowDto['mode'],
      skipReason: (r.skipReason as string) ?? null,
      subject: (r.subject as string) ?? null,
      deliveryState: (r.deliveryState as string) ?? null,
      occurredAt: new Date(r.occurredAt as string | Date).toISOString(),
    })),
  }
}
