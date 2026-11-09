import 'server-only'
import { randomUUID } from 'node:crypto'
import { admitAgentRequestOnce, voidUndeliveredRequest } from '@/db/credits/agentRequests'
import { withAiOperation } from '@/lib/ai/usage/context'

/**
 * Puts one AI reply draft under the same allowance and credits as the Agent.
 *
 *   COUNTED      one request per draft produced, whether or not it is sent.
 *   NOT COUNTED  a draft that was not produced (provider failure, unusable
 *                output): the request is voided, so pressing again is one request
 *                in total. A repeat of the same press runs nothing.
 *
 * The browser's id is single-use, and it is namespaced by user and lead so one
 * user cannot spend another's. A replay is refused before any model runs:
 * accepting it would be unlimited drafts for one counted request. A missing or
 * malformed id gets a fresh server id, so it counts normally and is never free.
 * Every provider call inside, including the router's own retries, is recorded
 * under this one operation.
 */

export const REPLY_DRAFT_OPERATION_KIND = 'whatsapp_reply_draft'

export type ReplyDraftRefusal = 'ai-credits-exhausted' | 'ai-unavailable' | 'duplicate-request'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function runReplyDraftRequest<T>(
  input: { user: { id: number; agencyId: number }; leadId: number; requestId?: unknown },
  refused: (why: ReplyDraftRefusal) => T,
  run: () => Promise<{ result: T; delivered: boolean }>,
): Promise<T> {
  const { user, leadId, requestId } = input
  const press = typeof requestId === 'string' && UUID.test(requestId) ? requestId.toLowerCase() : randomUUID()
  const operation = { kind: REPLY_DRAFT_OPERATION_KIND, id: `${user.id}:${leadId}:${press}` }

  const { admission, firstSeen } = await admitAgentRequestOnce({ agencyId: user.agencyId, userId: user.id, source: 'web', operation, nowMs: Date.now() })
  if (!firstSeen) return refused('duplicate-request')
  if ('reason' in admission) return refused(admission.reason === 'credits_required' ? 'ai-credits-exhausted' : 'ai-unavailable')

  try {
    const { result, delivered } = await withAiOperation({ ...operation, agencyId: user.agencyId, userId: user.id, leadId }, run)
    if (!delivered) await voidUndeliveredRequest(user.agencyId, operation)
    return result
  } catch (err) {
    await voidUndeliveredRequest(user.agencyId, operation)
    throw err
  }
}
