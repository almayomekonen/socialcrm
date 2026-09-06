'use client'

import { useCallback, useRef, useState } from 'react'
import { decideOnAgentAction } from '@/actions/ai/agentAction'
import type { AgentAnswer, AgentResult } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions/types'
import { failureMessage, type AgentUiTurn } from './agentTypes'

/**
 * The conversation with the real agent.
 *
 * ALL the transport lives here and none of it lives in a component: the page
 * renders `turns` and calls `ask`. That is the boundary the brief asks for —
 * no business logic in the React tree, no model call from the browser, one
 * server entry point.
 *
 * HISTORY IS SENT, NOT STORED. Prior turns travel with each request so a
 * follow-up like "ומה דחוף?" has a referent. Only the question text and the
 * previous answer's HEADLINE are sent: claims carry evidence refs that are
 * meaningless outside the run that produced them, and replaying them would
 * dress last turn's evidence up as this turn's. The server caps and normalises
 * the list again on arrival — this is a convenience, never the enforcement.
 *
 * ONE INVESTIGATION AT A TIME. A second question while one is in flight aborts
 * the first: the rep has moved on, and paying for an answer nobody will read is
 * waste. The abort reaches the model call through the request signal.
 */

const ENDPOINT = '/api/ai/agent/stream'

/** Turns kept locally and sent as context. The server enforces its own cap. */
const HISTORY_LIMIT = 6

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Parse the SSE frames out of a byte stream.
 *
 * Frames are separated by a blank line and can be split across chunks, so the
 * remainder is carried between reads rather than assuming one frame per chunk —
 * the bug that makes hand-rolled SSE clients drop events under load.
 */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let split: number
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)

      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) continue
      try {
        yield { event, data: JSON.parse(dataLines.join('\n')) }
      } catch {
        // A frame we cannot parse is dropped rather than killing the stream —
        // the answer frame may still be coming.
      }
    }
  }
}

export type UseAgentConversation = {
  turns: AgentUiTurn[]
  /** True while an investigation is in flight. */
  busy: boolean
  ask: (question: string) => void
  reset: () => void
  /** A human approving or rejecting a proposed action. No model call. */
  decide: (
    turnId: string,
    actionId: string,
    argsHash: string,
    decision: 'APPROVED' | 'REJECTED',
  ) => Promise<void>
}

export function useAgentConversation(): UseAgentConversation {
  const [turns, setTurns] = useState<AgentUiTurn[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Read inside `ask` without making it depend on render state, so a follow-up
  // asked while the previous answer is still settling still sees the history.
  const turnsRef = useRef<AgentUiTurn[]>([])
  turnsRef.current = turns

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setTurns([])
    setBusy(false)
  }, [])

  const ask = useCallback((question: string) => {
    const text = question.trim()
    if (!text) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Question and thinking placeholder in ONE update, so the thread animates once.
    const agentId = newId('a')
    const history = buildHistory(turnsRef.current)
    setTurns((prev) => [
      ...prev,
      { id: newId('u'), role: 'user', text },
      { id: agentId, role: 'agent', status: 'thinking', tools: [] },
    ])
    setBusy(true)

    const replace = (next: AgentUiTurn) =>
      setTurns((prev) => prev.map((t) => (t.id === agentId ? next : t)))

    void (async () => {
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: text, history }),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          // The route answers auth/rollout failures as JSON, not as a stream.
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          replace({ id: agentId, role: 'agent', status: 'error', message: httpMessage(res.status, payload?.error) })
          return
        }

        let settled = false
        for await (const { event, data } of readEvents(res.body)) {
          if (event === 'progress') {
            const tool = (data as { tool?: string })?.tool
            if (!tool) continue
            setTurns((prev) =>
              prev.map((t) =>
                t.id === agentId && t.role === 'agent' && t.status === 'thinking'
                  ? { ...t, tools: t.tools.includes(tool) ? t.tools : [...t.tools, tool] }
                  : t,
              ),
            )
          } else if (event === 'answer') {
            settled = true
            const result = data as AgentResult | null
            // `ok === true` rather than a truthiness check: the union only
            // narrows on the discriminant, and the failure branch is where
            // `reason` lives.
            if (result && result.ok === true) {
              replace({
                id: agentId,
                role: 'agent',
                status: 'done',
                answer: result.answer as AgentAnswer,
                investigationId: result.investigationId,
                // Carried straight through. The UI never derives an action's
                // fate from the answer's prose; if this is absent the card
                // renders as waiting, which is the honest default.
                actionOutcome: result.actionOutcome ?? null,
              })
            } else if (result && result.ok === false) {
              replace({ id: agentId, role: 'agent', status: 'error', message: failureMessage(result.reason) })
            } else {
              // A frame that parsed but carries no recognisable result.
              replace({ id: agentId, role: 'agent', status: 'error', message: failureMessage('error') })
            }
          } else if (event === 'error') {
            settled = true
            replace({ id: agentId, role: 'agent', status: 'error', message: failureMessage('error') })
          }
        }

        // The stream ended without an outcome — a dropped connection, not a
        // refusal. Saying nothing would leave a thinking row spinning forever.
        if (!settled) {
          replace({ id: agentId, role: 'agent', status: 'error', message: failureMessage('error') })
        }
      } catch (err) {
        // An abort is the rep moving on, not a failure: drop the placeholder.
        if ((err as Error)?.name === 'AbortError') {
          setTurns((prev) => prev.filter((t) => t.id !== agentId))
          return
        }
        replace({ id: agentId, role: 'agent', status: 'error', message: failureMessage('error') })
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setBusy(false)
        }
      }
    })()
  }, [])

  /**
   * A human approving or rejecting a proposed action.
   *
   * The client sends an id and the hash it displayed — never arguments. The
   * server rebuilds the action from its own durable row, so there is no
   * parameter here through which a different task could be created than the one
   * the rep read on screen.
   *
   * The outcome replaces the turn's own outcome in place, so the card moves
   * through its states without the thread re-ordering underneath the rep.
   */
  const decide = useCallback(async (turnId: string, actionId: string, argsHash: string, decision: 'APPROVED' | 'REJECTED') => {
    setTurns((prev) =>
      prev.map((t) => (t.id === turnId && t.role === 'agent' && t.status === 'done' ? { ...t, actionPending: true } : t)),
    )
    let outcome: ActionOutcome | null = null
    try {
      const res = await decideOnAgentAction({ actionId, argsHash, decision })
      outcome = res.ok ? res.outcome : null
    } catch {
      // Leave the outcome null: the card falls back to waiting rather than
      // claiming anything happened.
      outcome = null
    }
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId && t.role === 'agent' && t.status === 'done'
          ? { ...t, actionPending: false, actionOutcome: outcome ?? t.actionOutcome ?? null }
          : t,
      ),
    )
  }, [])

  return { turns, busy, ask, reset, decide }
}

/** HTTP-level outcomes the stream never starts for. */
function httpMessage(status: number, error?: string): string {
  if (status === 401) return 'צריך להתחבר מחדש כדי להשתמש בסוכן.'
  if (status === 403) return 'אין גישה לסוכן עם המנוי הנוכחי.'
  if (status === 404 || error === 'agent-disabled') return 'הסוכן עדיין לא פעיל בסביבת העבודה הזו.'
  return failureMessage('error')
}

/**
 * The prior exchange, as the model should see it.
 *
 * Only settled turns: a thinking row has no content and an errored one asserted
 * nothing, so neither belongs in the context. Assistant turns contribute their
 * headline alone — see the note at the top of this file.
 */
function buildHistory(turns: AgentUiTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', content: t.text })
    else if (t.status === 'done') out.push({ role: 'assistant', content: t.answer.headline })
  }
  return out.slice(-HISTORY_LIMIT)
}
