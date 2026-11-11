'use client'

import { useRef, useState } from 'react'
import { previewAgentTurn, type PreviewTurn } from '@/actions/autoResponse/previewAgent'

/**
 * The test conversation's state and its one network call, moved out of
 * `AgentPreview.tsx` unchanged so the same conversation can render in the
 * desktop side panel and in the narrow-screen dialog without being duplicated.
 *
 * ISOLATION. The whole conversation lives here and is posted back on every
 * turn. Nothing is persisted: `previewAgentTurn` performs no WhatsApp send and
 * writes no conversation, lead, job or notification.
 */

export type Bubble = {
  id: number
  direction: 'inbound' | 'outbound'
  text: string
  note?: string | null
  usedDraft?: boolean
}

const ERROR_COPY: Record<string, string> = {
  no_description: 'כדי לבדוק את הסוכן צריך קודם לכתוב על העסק בשדה למעלה.',
  forbidden: 'רק מנהל יכול לבדוק את הסוכן.',
  ai_unavailable: 'השירות לא זמין כרגע. נסו שוב בעוד רגע.',
  budget_exhausted: 'נגמרה מכסת השימוש היומית. נסו שוב מחר.',
  empty_transcript: 'כתבו הודעה כדי להתחיל.',
  no_pending_inbound: 'כתבו הודעה כדי להתחיל.',
  conversational_unavailable: 'הסוכן החכם לא פעיל כרגע בוואטסאפ של העסק (למשל כשהשאלון פעיל או כשנבחרה הודעה קבועה), ולכן אי אפשר לבדוק אותו כאן.',
  agent_paused: 'המענה החכם מושהה כרגע במערכת, ולכן אי אפשר לבדוק אותו. נסו שוב מאוחר יותר.',
}

let nextId = 1

export function useAgentPreviewChat({ draftDescription, draftAgentInstructions }: { draftDescription: string; draftAgentInstructions: string }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Conversational agent: the AI state the real agent would have after the last turn, passed back each time.
  const [agentState, setAgentState] = useState<unknown>(undefined)
  const endRef = useRef<HTMLDivElement>(null)

  function reset() {
    setBubbles([])
    setInput('')
    setError(null)
    setAgentState(undefined)
  }

  async function send() {
    const text = input.trim()
    if (!text || pending) return
    setError(null)
    setInput('')

    const mine: Bubble = { id: nextId++, direction: 'inbound', text }
    const history: PreviewTurn[] = [...bubbles, mine].map((b) => ({ direction: b.direction, text: b.text }))
    setBubbles((prev) => [...prev, mine])
    setPending(true)

    try {
      const result = await previewAgentTurn({
        transcript: history,
        draftDescription,
        draftAgentInstructions,
        ...(agentState !== undefined ? { state: agentState } : {}),
      })
      if (result.ok === false) {
        setError(ERROR_COPY[result.reason] ?? 'משהו השתבש. נסו שוב.')
        return
      }
      if (result.state) setAgentState(result.state)
      // A silent turn is a real outcome (opt-out, a close). Show the reason
      // rather than an empty bubble, so "nothing happened" is never ambiguous.
      if (!result.reply.trim()) {
        setBubbles((prev) => [
          ...prev,
          { id: nextId++, direction: 'outbound', text: '', note: result.trace.simulated ?? 'הסוכן לא היה שולח כלום כאן.' },
        ])
        return
      }
      setBubbles((prev) => [
        ...prev,
        { id: nextId++, direction: 'outbound', text: result.reply, note: result.trace.simulated, usedDraft: result.usedDraft },
      ])
    } catch {
      setError('משהו השתבש. נסו שוב.')
    } finally {
      setPending(false)
      // Scrolling is a nicety. It must never be able to throw inside `finally`
      // and leave the composer stuck in its pending state.
      try {
        endRef.current?.scrollIntoView?.({ block: 'nearest' })
      } catch {
        /* not scrollable here; the reply is already rendered */
      }
    }
  }

  return { bubbles, input, setInput, pending, error, reset, send, endRef }
}

export type AgentPreviewChatState = ReturnType<typeof useAgentPreviewChat>
