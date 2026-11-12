import 'server-only'
import { db } from '@/config/db'
import { findSmartbeeDocument, type SmartbeeDocumentRow } from './documents'

/**
 * Settling a `stalled` SmartBee document: SmartBee never confirmed, so the
 * connection OWNER checked SmartBee and approved, on a card, what they found.
 * Written ONLY by the `resolve_smartbee_document` action
 * (lib/agent/actions/domain/resolveSmartbeeDocument.ts). Every query names the agency.
 */

const T = 'smartbee_documents'

/** The newest stalled document with no resolution yet, in this agency. */
export async function latestUnresolvedStalledDocument(agencyId: number): Promise<SmartbeeDocumentRow | null> {
  const row = (await db(T).where({ agencyId, status: 'stalled' }).whereNull('resolution').orderBy('id', 'desc').first('id')) as { id: number | string } | undefined
  return row ? findSmartbeeDocument(agencyId, Number(row.id)) : null
}

export type ResolutionResult = 'recorded' | 'already_recorded' | 'not_resolvable'

/**
 * One guarded UPDATE: only a stalled, unresolved row of THIS agency. A retry of
 * the same approved action finds its own resolution (`resolutionActionId`) and
 * reports it, never a second write.
 */
export async function recordSmartbeeResolution(input: {
  agencyId: number
  documentId: number
  resolution: 'exists' | 'absent'
  docIndex: string | null
  resolvedByUserId: number
  actionId: string
  nowMs: number
}): Promise<ResolutionResult> {
  const n = await db(T)
    .where({ agencyId: input.agencyId, id: input.documentId, status: 'stalled' })
    .whereNull('resolution')
    .update({
      resolution: input.resolution,
      resolvedDocIndex: input.resolution === 'exists' ? input.docIndex : null,
      resolvedByUserId: input.resolvedByUserId,
      resolvedAt: new Date(input.nowMs),
      resolutionActionId: input.actionId,
      updatedAt: db.fn.now(),
    })
  if (n === 1) return 'recorded'
  const row = (await db(T).where({ agencyId: input.agencyId, id: input.documentId }).first('resolutionActionId')) as { resolutionActionId: string | null } | undefined
  return row?.resolutionActionId === input.actionId ? 'already_recorded' : 'not_resolvable'
}
