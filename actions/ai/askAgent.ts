'use server'

import { runAgentInvestigation, type AgentTurn } from '@/lib/agent/run'
import { recordAgentInvestigation, type AgentInvestigationInput } from '@/db/agentInvestigation'
import type { AgentResult } from '@/lib/agent/types'

/**
 * Server-action entry point for one Agent investigation.
 *
 * Deliberately thin. Every guarantee already lives below it: authorization and
 * agency isolation in `resolveAgentScope`, entitlement and spend in
 * `admitAiRun`, bounds in the Budget, and truthfulness in
 * `validateAgentAnswer`. Anything this file decided for itself would be a second
 * copy of a rule that already has one home.
 *
 * The one thing it does own is the question, because that is the only value the
 * caller supplies. It is capped so a pathological input cannot inflate a single
 * investigation's prompt cost; it is NOT sanitised beyond that, since it reaches
 * the model as a prompt and never as authorization.
 *
 * DEPLOYMENT NOTE — `maxDuration` cannot live here. A `'use server'` module may
 * only export async functions, so the platform function timeout is inherited
 * from the ROUTE SEGMENT that invokes this action. The Agent's budget allows up
 * to DEFAULT_DEADLINE_MS (40s), so the caller's segment must declare the
 * repository's convention for long work — `export const maxDuration = 60`.
 *
 * `app/api/ai/agent/route.ts` is that caller and declares it. A globally-mounted
 * Copilot could not: a Server Action runs under whichever of the 46 page
 * segments the user happens to be on, so a route is the only place the Agent's
 * runtime has a single, controllable home.
 */

/** Upper bound on one question. Long enough for any real ask, short enough to bound cost. */
const MAX_QUESTION_CHARS = 1_000

/**
 * Prior turns forwarded to the model, newest kept.
 *
 * Six is three exchanges — enough for "מי צריך טיפול" → "ומה דחוף" → "ומה עם
 * יוסי", which is the depth follow-ups actually reach — and bounded so a long
 * session cannot grow the prompt without limit. Each turn is capped too: an
 * assistant headline is one sentence and a question is already capped, but the
 * cap is applied here rather than trusted because this list arrives from a
 * request.
 */
const MAX_HISTORY_TURNS = 6
const MAX_TURN_CHARS = 600

/**
 * The durable record, and the guard around it.
 *
 * The loop calls this only AFTER validation, and never for an admission denial —
 * nothing was investigated, so there is nothing to record. A write failure is
 * swallowed here and nowhere else: the rep's answer is already correct, and
 * losing a history row must never turn a good answer into an error. This is the
 * same posture `insertQualifyDraftReview` takes in the Qualifier.
 */
async function persistQuietly(record: AgentInvestigationInput): Promise<void> {
  try {
    await recordAgentInvestigation(record)
  } catch (e) {
    console.error(`[AGENT-PERSIST] failed inv=${record.investigationId}:`, (e as Error).message)
  }
}

/**
 * `abortSignal` is the ONLY thing besides the question a caller may supply, and
 * it can only ever shorten an investigation. The route passes the request's own
 * signal so a rep who navigates away stops paying for a generation nobody will
 * read. Everything else — agency, permissions, entitlement, budget, model,
 * investigation id — stays server-derived and is unreachable from a request.
 */
export async function askAgent(
  question: string,
  abortSignal?: AbortSignal,
  options?: { history?: AgentTurn[]; onProgress?: (e: { tool: string; step: number }) => void },
): Promise<AgentResult> {
  const trimmed = (question ?? '').trim()
  if (!trimmed) return { ok: false, reason: 'error', message: 'empty-question' }

  return runAgentInvestigation({
    question: trimmed.slice(0, MAX_QUESTION_CHARS),
    history: sanitiseHistory(options?.history),
    onProgress: options?.onProgress,
    abortSignal,
    onPersist: persistQuietly,
  })
}

/**
 * Bound and normalise caller-supplied turns.
 *
 * It caps count and length and drops anything that is not one of the two roles
 * or not a non-empty string. It deliberately does NOT attempt to verify that an
 * assistant turn is something this system actually said — that is unverifiable
 * from a request, and the trust boundary does not depend on it: history is
 * prompt context, and every claim in the answer is still validated against the
 * evidence collected in THIS run. See `RunAgentInput.history`.
 */
function sanitiseHistory(history?: AgentTurn[]): AgentTurn[] {
  if (!Array.isArray(history)) return []
  return history
    .filter((t): t is AgentTurn => {
      if (!t || (t.role !== 'user' && t.role !== 'assistant')) return false
      return typeof t.content === 'string' && t.content.trim().length > 0
    })
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.content.trim().slice(0, MAX_TURN_CHARS) }))
}
