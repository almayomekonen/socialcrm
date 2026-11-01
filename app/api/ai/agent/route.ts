import { NextRequest, NextResponse } from 'next/server'
import { AuthError, ProductAccessError, requireProductAccess } from '@/lib/requireUser'
import { isAgentAvailable } from '@/lib/ai/agentAvailability'
import { askAgent } from '@/actions/ai/askAgent'

/**
 * POST /api/ai/agent — the CRM Agent's only caller-facing surface.
 *
 * WHY A ROUTE AND NOT A SERVER ACTION. Every other AI entry point in this
 * codebase is a Server Action, and for the Agent that pattern cannot hold the
 * one thing it needs: a controllable runtime. A Server Action executes under the
 * route segment the user is currently on, and the Copilot is mounted globally in
 * `app/(app)/layout.tsx` — so pinning the Agent's duration through an action
 * would mean adding `maxDuration` to all 46 page segments and never missing one.
 * A route has exactly one segment and one `maxDuration`.
 *
 * It is transport ONLY. It decides who may ask and what counts as a question,
 * then hands the question to the existing `askAgent` path. It performs no
 * admission of its own: `admitAiRun` still runs inside every investigation and
 * remains the single implementation of AI_ENABLED, the agency allowlist,
 * entitlement, provider configuration and the daily spend cap. There is no
 * second gate here, no model selection, no persistence and no generation.
 *
 * THE BODY CONTROLS NOTHING BUT THE QUESTION. `runAgentInvestigation` accepts
 * `maxSteps`, `deadlineMs` and `investigationId`, and every one of them would be
 * dangerous from a request: a supplied `investigationId` would let a client
 * overwrite another investigation's history row (persistence is
 * first-write-wins), and a supplied budget would defeat the ceiling the tools
 * enforce. So this parses exactly one field and forwards exactly one value. The
 * only other thing passed is the request's own abort signal, which can only ever
 * shorten a run.
 *
 * `isAgentEnabled` is a ROLLOUT gate layered on top of admission, not a
 * replacement for it — an agency that is not opted in gets 404 before any AI
 * work is attempted.
 */

export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' } as const

/** Longest question accepted at the edge. `askAgent` also caps what it forwards. */
const MAX_QUESTION_CHARS = 1_000

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Who is asking. requireProductAccess throws rather than redirecting, so it
  //    behaves identically here and in a Server Action.
  let user
  try {
    user = await requireProductAccess()
  } catch (err) {
    if (err instanceof AuthError) return json({ error: 'unauthorized' }, 401)
    if (err instanceof ProductAccessError) return json({ error: err.message }, 403)
    // An unexpected auth-layer failure is infrastructure, not a rejection: it
    // must not read to the client as "you are signed out".
    console.error('[AGENT-ROUTE] auth failed:', (err as Error)?.message)
    return json({ error: 'unavailable' }, 500)
  }

  // ── Is this surface switched on for them. Session agency only.
  if (!(await isAgentAvailable(user.agencyId))) return json({ error: 'agent-disabled' }, 404)

  // ── What is being asked. One field, and it must be a real string.
  const body = (await req.json().catch(() => null)) as { question?: unknown } | null
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return json({ error: 'invalid-question' }, 400)

  try {
    // The question and the abort signal. Nothing else from the request.
    const result = await askAgent(question.slice(0, MAX_QUESTION_CHARS), req.signal)
    // A denial, refusal or provider failure is a business outcome the client
    // renders, not a transport error — it comes back 200 with its typed reason,
    // the way the Copilot's own actions already report entitlement states.
    return json(result)
  } catch (err) {
    // Never surface a provider message or stack: it can carry keys and model ids.
    console.error('[AGENT-ROUTE] investigation failed:', (err as Error)?.message)
    return json({ error: 'unavailable' }, 500)
  }
}
