'use server'

import { revalidatePath } from 'next/cache'
import { resolveAgentScope } from '@/lib/agent/scope'
import { decideOnAction, type ActionDecisionResult } from '@/lib/agent/actions/bridge'

/**
 * The approval boundary — a person deciding, not a model.
 *
 * Deliberately thin, for the same reason `askAgent` is: every guarantee already
 * has a home below it. `resolveAgentScope` establishes who is deciding and which
 * agency they decide for, the bridge refuses an action whose stored arguments do
 * not match the ones the caller was shown, and the Action Runtime re-runs the
 * whole policy → approval → execute → verify sequence rather than trusting that
 * an approval means the earlier checks still hold.
 *
 * NO MODEL CALL. Approving costs nothing beyond the mutation itself: the action
 * is rebuilt from its durable row, not regenerated.
 *
 * WHAT THE CLIENT MAY SEND is an id and a hash — never arguments. There is no
 * parameter here through which a different task could be created than the one
 * that was proposed and displayed.
 */
export async function decideOnAgentAction(input: {
  actionId: string
  /** The hash the approval UI displayed. Must match the stored row exactly. */
  argsHash: string
  decision: 'APPROVED' | 'REJECTED'
}): Promise<ActionDecisionResult> {
  const actionId = String(input?.actionId ?? '').trim()
  const argsHash = String(input?.argsHash ?? '').trim()
  if (!actionId || !argsHash) return { ok: false, reason: 'not-found' }
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') return { ok: false, reason: 'not-found' }

  const scope = await resolveAgentScope()
  const result = await decideOnAction({ actionId, argsHash, decision: input.decision, scope })

  // Only a verified mutation is worth invalidating a cache for. Anything else
  // left the CRM as it was, and revalidating would imply otherwise.
  if (result.ok && result.outcome.report === 'VERIFIED_SUCCESS') {
    revalidatePath('/tasks')
    revalidatePath('/clients', 'layout')
  }

  return result
}
