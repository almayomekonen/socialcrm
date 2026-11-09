import 'server-only'
import { randomUUID } from 'node:crypto'
import { admitAgentRequest } from '@/db/credits/agentRequests'
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

export async function runCopilotRequest<T>(user: { id: number; agencyId: number }, blocked: () => T, run: () => Promise<T>): Promise<T> {
  if (currentAiOperation()?.kind === COPILOT_OPERATION_KIND) return run()
  const id = randomUUID()
  const access = await admitAgentRequest({ agencyId: user.agencyId, userId: user.id, source: 'web', operation: { kind: COPILOT_OPERATION_KIND, id }, nowMs: Date.now() })
  if ('reason' in access) return blocked()
  return withAiOperation({ kind: COPILOT_OPERATION_KIND, id, agencyId: user.agencyId, userId: user.id }, run)
}
