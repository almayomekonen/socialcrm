import { NextRequest } from 'next/server'
import { AuthError, ProductAccessError, requireProductAccess } from '@/lib/requireUser'
import { isAgentAvailable } from '@/lib/ai/agentAvailability'
import { askAgent } from '@/actions/ai/askAgent'
import type { AgentTurn } from '@/lib/agent/run'

/**
 * POST /api/ai/agent/stream — the conversational surface for "הסוכן שלך".
 *
 * WHAT IS STREAMED, AND WHAT DELIBERATELY IS NOT.
 *
 * This streams PROGRESS, then one validated answer. It does not stream the
 * model's prose token by token, and that is a correctness decision rather than a
 * shortcut.
 *
 * The Agent's answer is a structured object whose every claim is checked against
 * the evidence the tools actually collected — `validateAgentAnswer` drops any
 * claim whose refs do not resolve and refuses the whole answer when none
 * survive. That check cannot run until the object is complete. Streaming raw
 * tokens would therefore put unvalidated, possibly fabricated CRM statements on
 * the rep's screen and retract them a second later, which is precisely the
 * failure the trust boundary exists to prevent — and the retraction would come
 * after they had already read it.
 *
 * So the wait is filled honestly instead: the client is told WHICH capability is
 * running, as each one starts. That is real work being reported, not a
 * progress-shaped animation over a blocking call. When the answer arrives it is
 * post-validation and final.
 *
 * WIRE FORMAT — server-sent events, one JSON object per `data:` line:
 *   progress  { tool, step }   a tool call was admitted and is executing
 *   answer    AgentResult      the validated outcome (ok true or false)
 *   error     { error }        transport or auth failure
 *
 * The existing `POST /api/ai/agent` is untouched and still serves the
 * request/response shape. This route adds a transport; it adds no capability,
 * no second gate and no business logic. Authorization, admission, budget,
 * validation and persistence all remain exactly where they were — this handler
 * calls the same `askAgent` the other route does.
 */

export const maxDuration = 60

/** Longest question accepted at the edge, mirroring the non-streaming route. */
const MAX_QUESTION_CHARS = 1_000

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  Connection: 'keep-alive',
  // Nginx and some proxies buffer streamed responses without this, which turns
  // progress events into one burst at the end — the exact opposite of the point.
  'X-Accel-Buffering': 'no',
} as const

function errorResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest): Promise<Response> {
  // ── Who is asking. Identical to the non-streaming route: this is the same
  //    boundary, not a second one.
  let user
  try {
    user = await requireProductAccess()
  } catch (err) {
    if (err instanceof AuthError) return errorResponse({ error: 'unauthorized' }, 401)
    if (err instanceof ProductAccessError) return errorResponse({ error: err.message }, 403)
    console.error('[AGENT-STREAM] auth failed:', (err as Error)?.message)
    return errorResponse({ error: 'unavailable' }, 500)
  }

  if (!(await isAgentAvailable(user.agencyId))) return errorResponse({ error: 'agent-disabled' }, 404)

  const body = (await req.json().catch(() => null)) as { question?: unknown; history?: unknown } | null
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return errorResponse({ error: 'invalid-question' }, 400)

  // Shape-checked here; `askAgent` owns the caps and the real normalisation, so
  // there is one implementation of that rule rather than two.
  const history: AgentTurn[] = Array.isArray(body?.history) ? (body.history as AgentTurn[]) : []

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (event: string, data: unknown) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // The client hung up between the check and the write. Nothing to do:
          // the investigation is already cancelled by the abort signal below.
          open = false
        }
      }

      try {
        const result = await askAgent(question.slice(0, MAX_QUESTION_CHARS), req.signal, {
          history,
          // Fired from inside the Budget as each tool call is admitted, so the
          // rep sees the investigation working rather than a spinner.
          onProgress: (e) => send('progress', e),
        })
        // A refusal, denial or provider failure is a business outcome the client
        // renders — it arrives as an `answer` event carrying `ok: false`, the
        // same way the non-streaming route returns it with HTTP 200.
        send('answer', result)
      } catch (err) {
        // Never surface a provider message: it can carry keys and model ids.
        console.error('[AGENT-STREAM] investigation failed:', (err as Error)?.message)
        send('error', { error: 'unavailable' })
      } finally {
        open = false
        try {
          controller.close()
        } catch {
          /* already closed by a client disconnect */
        }
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
