import 'server-only'
import { z } from 'zod'
import { resolveIntegrationAccess } from '@/lib/integrations/core/permissions'
import { findSmartbeeDocument } from '@/db/smartbee/documents'
import { recordSmartbeeResolution } from '@/db/smartbee/resolutions'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationResult } from '../types'

/**
 * `resolve_smartbee_document` — the connection OWNER records what they found in
 * SmartBee for a document SmartBee never confirmed (`stalled`): it `exists`
 * (optionally with its number) or it is `absent`. Until then that lead gets no
 * new document (db/smartbee/documents.ts, unsettledSmartbeeDocument).
 *
 * APPLICATION-PROPOSED ONLY (a SystemActionProposal from
 * lib/waAssistant/smartbee/resolve.ts, opened by the owner's own fixed words);
 * the model's answer schema cannot name this type. ALWAYS A CARD, and the owner
 * check runs again HERE. Nothing is sent to SmartBee or to anyone else.
 */

const resolveArgs = z.object({
  smartbeeDocumentId: z.number().int().positive(),
  resolution: z.enum(['exists', 'absent']),
  docIndex: z.string().regex(/^\d{1,12}$/).nullable(),
})

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = resolveArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const a = parsed.data
  const access = await resolveIntegrationAccess({ provider: 'smartbee', agencyId: ctx.actor.agencyId, userId: ctx.actor.userId })
  if (access.ok === false) return { status: 'NOT_AUTHORIZED', reason: `smartbee-${access.reason}` }

  const r = await recordSmartbeeResolution({
    agencyId: ctx.actor.agencyId,
    documentId: a.smartbeeDocumentId,
    resolution: a.resolution,
    docIndex: a.docIndex,
    resolvedByUserId: ctx.actor.userId,
    actionId: action.actionId,
    nowMs: ctx.nowMs,
  })
  if (r === 'not_resolvable') return { status: 'FAILED', reason: 'smartbee-document-not-resolvable' }
  return { status: 'SUCCESS', targetIds: [{ kind: 'smartbee_document', id: String(a.smartbeeDocumentId) }], detail: { created: r === 'recorded' } }
}

async function check(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = resolveArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const a = parsed.data
  const row = await findSmartbeeDocument(ctx.actor.agencyId, a.smartbeeDocumentId)
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'smartbee-document-not-found' }
  const checks = [
    { name: 'resolution', ok: row.resolution === a.resolution, expected: a.resolution, actual: row.resolution },
    { name: 'by', ok: row.resolvedByUserId === ctx.actor.userId, expected: ctx.actor.userId, actual: row.resolvedByUserId },
    { name: 'action', ok: row.resolutionActionId === action.actionId, expected: 'this action', actual: row.resolutionActionId === action.actionId ? 'same' : 'other' },
  ]
  const ok = checks.every((c) => c.ok)
  return { state: ok ? 'VERIFIED' : 'MISMATCH', verified: ok, checks, targetIds: [{ kind: 'smartbee_document', id: String(row.id) }], reason: ok ? null : 'postcondition-mismatch' }
}

export const resolveSmartbeeDocumentAction: AgentActionDefinition = {
  type: 'resolve_smartbee_document',
  argsSchema: resolveArgs as never,
  risk: 'APPROVAL_REQUIRED',
  requiresApproval: true,
  execute,
  verify: (action, _execution, ctx) => check(action, ctx),
  probe: check,
}
