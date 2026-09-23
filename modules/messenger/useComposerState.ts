'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { sendMessengerTyping } from './actions'

/**
 * Composer state that must survive things the rep did not choose: a refresh, a
 * failed send, switching conversations and coming back.
 */

const DRAFT_KEY = (conversationId: number) => `messenger:draft:${conversationId}`

/**
 * A draft, kept per conversation in sessionStorage.
 *
 * WHY IT EXISTS. The inbox polls and calls `router.refresh()`; a rep typing a
 * long reply must never lose it to a background refresh, a mis-tap, or a send
 * that failed. Losing typed text is the kind of small betrayal that stops people
 * trusting a tool.
 *
 * WHY sessionStorage. It is per-tab and per-viewer, cleared when the tab closes,
 * and never reaches the server — an unsent draft is the rep's, not the CRM's.
 * Every access is wrapped: in a private window, with site data blocked, or
 * during a thumbnail capture, the accessor can throw, and a composer that cannot
 * remember a draft must still work perfectly.
 */
export function useMessengerDraft(conversationId: number) {
  const [draft, setDraft] = useState('')

  // Deliberately keyed on conversationId: switching conversations loads THAT
  // conversation's draft rather than carrying one thread's text into another.
  useEffect(() => {
    try {
      setDraft(sessionStorage.getItem(DRAFT_KEY(conversationId)) ?? '')
    } catch {
      setDraft('')
    }
  }, [conversationId])

  const update = useCallback(
    (value: string) => {
      setDraft(value)
      try {
        if (value) sessionStorage.setItem(DRAFT_KEY(conversationId), value)
        else sessionStorage.removeItem(DRAFT_KEY(conversationId))
      } catch {
        // Storage unavailable — the draft simply is not remembered. Never fatal.
      }
    },
    [conversationId],
  )

  const clear = useCallback(() => update(''), [update])

  return { draft, setDraft: update, clearDraft: clear }
}

/** Messenger expires a typing indicator on its own; refresh before it lapses. */
const TYPING_REFRESH_MS = 9_000

/**
 * Typing indicator, driven by actual typing.
 *
 * Sends `typing_on` when the rep starts, refreshes it while they continue, and
 * `typing_off` when they stop, send, or leave. It is fire-and-forget: a typing
 * dot that fails is not something a rep can act on, so nothing is surfaced.
 *
 * The refresh interval exists because Meta drops the indicator after ~20s;
 * without it a customer watching a long reply being written would see the dots
 * vanish and assume the rep gave up.
 */
export function useMessengerTyping(conversationId: number) {
  const active = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (idle.current) clearTimeout(idle.current)
    if (timer.current) clearInterval(timer.current)
    idle.current = null
    timer.current = null
    if (!active.current) return
    active.current = false
    void sendMessengerTyping(conversationId, false).catch(() => {})
  }, [conversationId])

  const typing = useCallback(() => {
    if (!active.current) {
      active.current = true
      void sendMessengerTyping(conversationId, true).catch(() => {})
      timer.current = setInterval(() => {
        void sendMessengerTyping(conversationId, true).catch(() => {})
      }, TYPING_REFRESH_MS)
    }
    // Stopped typing for a beat ⇒ the customer should stop seeing dots.
    if (idle.current) clearTimeout(idle.current)
    idle.current = setTimeout(stop, TYPING_REFRESH_MS)
  }, [conversationId, stop])

  // Leaving the conversation, closing the tab, or unmounting must not strand a
  // customer watching dots that will never resolve.
  useEffect(() => stop, [stop, conversationId])

  return { typing, stopTyping: stop }
}
