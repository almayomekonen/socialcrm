import 'server-only'
import { randomUUID } from 'node:crypto'
import { admitAgentRequest, voidUndeliveredRequest } from '@/db/credits/agentRequests'
import { currentAiOperation, withAiOperation } from '@/lib/ai/usage/context'

/**
 * Puts one Copilot question under the same allowance and credits as the Agent.
 *
 * Copilot used to run its models outside `agent_requests`, so opening it would
 * have been a free path around the 50 included requests. Each user-triggered
 * Copilot entry point now passes through here: admitted once, before any model
 * runs, and every provider call inside is recorded under this one operation, so
 * settlement charges one request for all of them.
 *
 * ONE QUESTION, ONE REQUEST. A general question can answer through the lead path,
 * which is itself an entry point; the inner one sees the operation already open
 * and joins it. The Agent has its own operation and is never reached from here:
 * the panel sends a question to the Agent or to these paths, never both.
 *
 * A request that called no model (a deterministic reply, a cached answer) settles
 * as void, like an Agent turn that called none.
 */

export const COPILOT_OPERATION_KIND = 'copilot_request'

export const COPILOT_LIMIT_NOTE = 'נוצלו הבקשות הכלולות החודש. אפשר להוסיף קרדיטים בעמוד מנוי ותשלום; ה-CRM ממשיך לעבוד כרגיל.'

/**
 * A Copilot result that carries no answer. Lead actions return `AiRunResult`
 * (`{ ok: false, reason }` when the model failed); a general answer has no `ok`
 * and is always a delivered reply.
 */
export function isUndeliveredCopilotResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'ok' in result && (result as { ok: unknown }).ok === false
}

export async function runCopilotRequest<T>(user: { id: number; agencyId: number }, blocked: () => T, run: () => Promise<T>): Promise<T> {
  if (currentAiOperation()?.kind === COPILOT_OPERATION_KIND) return run()
  const id = randomUUID()
  const operation = { kind: COPILOT_OPERATION_KIND, id }
  const access = await admitAgentRequest({ agencyId: user.agencyId, userId: user.id, source: 'web', operation, nowMs: Date.now() })
  if ('reason' in access) return blocked()
  try {
    const result = await withAiOperation({ ...operation, agencyId: user.agencyId, userId: user.id }, run)
    // A failed generation delivered nothing: it does not consume the allowance or credits.
    if (isUndeliveredCopilotResult(result)) await voidUndeliveredRequest(user.agencyId, operation)
    return result
  } catch (err) {
    await voidUndeliveredRequest(user.agencyId, operation)
    throw err
  }
}
