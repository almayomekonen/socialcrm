'use client'

import { useCallback, useEffect, useRef } from 'react'
import { signalHumanTyping } from '@/modules/inbox/actions'
import { HUMAN_TYPING_REFRESH_MS } from '@/lib/inbox/autoresponse/humanPresence'

/**
 * WhatsApp Agent — composer side of the Human Presence model.
 *
 * Returns one callback to call from the composer's `onChange`. The FIRST
 * keystroke fires immediately — that is the whole product promise, and a
 * debounce here would be a window in which the agent can still speak. Further
 * keystrokes are throttled to the refresh cadence, so a rep typing a paragraph
 * costs a handful of tiny writes rather than one per character.
 *
 * Deliberately NOT wired to focus, mount, scroll or read. Opening a conversation
 * does not stop the agent; only typing does.
 *
 * Failures are swallowed. A dropped heartbeat is a transient loss of protection,
 * never a broken composer — and the rep pressing send still takes over
 * permanently through the send action itself.
 */
export function useComposerTypingSignal(
  conversationId: number | null | undefined,
  opts: { refreshMs?: number; send?: (id: number) => Promise<unknown> } = {},
): () => void {
  const lastSentAt = useRef(0)
  const active = useRef(true)
  const refreshMs = opts.refreshMs ?? HUMAN_TYPING_REFRESH_MS
  const send = opts.send ?? signalHumanTyping

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  // Reset the throttle when the rep moves to another conversation, so the first
  // keystroke in the new thread is never swallowed by the previous one's window.
  useEffect(() => {
    lastSentAt.current = 0
  }, [conversationId])

  return useCallback(() => {
    if (conversationId == null || !Number.isFinite(conversationId) || conversationId <= 0) return
    const now = Date.now()
    if (now - lastSentAt.current < refreshMs) return
    lastSentAt.current = now
    void Promise.resolve(send(conversationId)).catch(() => {
      // Allow an immediate retry on the next keystroke rather than waiting out
      // the throttle on a heartbeat that never landed.
      if (active.current && lastSentAt.current === now) lastSentAt.current = 0
    })
  }, [conversationId, refreshMs, send])
}
