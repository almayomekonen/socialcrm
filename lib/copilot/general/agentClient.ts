import type { AgentResult } from '@/lib/agent/types'

/**
 * Browser client for POST /api/ai/agent.
 *
 * It exists so the panel never assembles a request body itself. The route
 * already refuses to forward anything but the question, but a client that SENDS
 * more is a defect waiting for a future route change to become a hole — so the
 * body is built in exactly one place, from exactly one value.
 *
 * Nothing from a previous answer is ever echoed back: `investigationId` is
 * server-minted and returned for tracing, and replaying it would let one client
 * overwrite another investigation's history row, since persistence is
 * first-write-wins.
 *
 * NEVER THROWS. A panel that has to guess whether a rejection was a network
 * failure or a refusal is how the audit found this surface failing silently.
 * Every outcome comes back as a value the caller must handle.
 */

/** Failure reasons the route returns, plus the transport catch-all. */
export type AgentAskFailure =
  | 'unauthorized'
  | 'subscription-required'
  | 'trial-not-started'
  | 'agent-disabled'
  | 'invalid-question'
  | 'unavailable'

export type AgentAsk = { ok: true; result: AgentResult } | { ok: false; reason: AgentAskFailure }

const KNOWN: ReadonlySet<string> = new Set<AgentAskFailure>([
  'unauthorized',
  'subscription-required',
  'trial-not-started',
  'agent-disabled',
  'invalid-question',
  'unavailable',
])

export async function askAgentApi(question: string, signal?: AbortSignal): Promise<AgentAsk> {
  try {
    const res = await fetch('/api/ai/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The ONLY field. Not spread from anything.
      body: JSON.stringify({ question }),
      signal,
    })

    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null

    if (!res.ok) {
      const reason = typeof body?.error === 'string' && KNOWN.has(body.error) ? (body.error as AgentAskFailure) : 'unavailable'
      return { ok: false, reason }
    }
    // A 200 carries an AgentResult — including its typed business failures,
    // which are outcomes the panel renders, not transport errors.
    if (!body || typeof body.ok !== 'boolean') return { ok: false, reason: 'unavailable' }
    return { ok: true, result: body as unknown as AgentResult }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
