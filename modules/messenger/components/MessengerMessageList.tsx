'use client'

import { useEffect, useRef, useState } from 'react'
import { formatBusinessDate as formatDate } from '@/lib/today/time'
import { loadOlderMessengerMessages } from '../actions'
import type { MessengerConversationEvent, MessengerMessage } from '../types'
import MessengerBubble from './MessengerBubble'
import MessengerEventLine from './MessengerEventLine'

/**
 * The scrolling message history, with "load earlier".
 *
 * SCROLL POSITION IS PRESERVED BY CONSTRUCTION. The container is
 * `flex-col-reverse`, so the browser anchors scrolling to the BOTTOM: the
 * newest message stays put, and prepending older ones (which render at the
 * visual top) does not move the viewport. This is why the list is reversed
 * rather than scrolled to the bottom with an effect — an effect that sets
 * `scrollTop` after paint is what produces the jump it is trying to fix.
 *
 * WHY THIS IS A CLIENT COMPONENT. Only "load earlier" needs state; the page
 * still renders the first page on the server, so the thread is complete and
 * readable before any JavaScript runs. `older` is kept separately from
 * `initial` so a background `router.refresh()` — which the inbox does every 10
 * seconds — brings new messages in without discarding the history the rep has
 * already scrolled back through.
 */
export default function MessengerMessageList({
  conversationId,
  initial,
  hasMoreInitially,
  events = [],
}: {
  conversationId: number
  /** Oldest-first, as the server produced it. */
  initial: MessengerMessage[]
  hasMoreInitially: boolean
  /** Postbacks, referrals and reactions for this conversation, oldest-first. */
  events?: MessengerConversationEvent[]
}) {
  const [older, setOlder] = useState<MessengerMessage[]>([])
  const [hasMore, setHasMore] = useState(hasMoreInitially)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const conversation = useRef(conversationId)

  // Switching conversations must not carry one thread's history into another.
  useEffect(() => {
    if (conversation.current === conversationId) return
    conversation.current = conversationId
    setOlder([])
    setHasMore(hasMoreInitially)
    setFailed(false)
  }, [conversationId, hasMoreInitially])

  const messages = [...older, ...initial]
  const oldestId = messages[0]?.id

  const loadOlder = async () => {
    if (loading || !oldestId) return
    setLoading(true)
    setFailed(false)
    try {
      const result = await loadOlderMessengerMessages(conversationId, oldestId)
      if (!('messages' in result)) {
        setFailed(true)
        return
      }
      // Guard against a double-tap racing two loads onto the same cursor.
      setOlder((prev) => {
        const known = new Set([...prev, ...initial].map((m) => m.id))
        return [...result.messages.filter((m) => !known.has(m.id)), ...prev]
      })
      setHasMore(result.hasMore)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  // Reactions attach to their message; postbacks and referrals are timeline
  // entries of their own.
  const reactionsFor = new Map<number, MessengerConversationEvent[]>()
  const timelineEvents: MessengerConversationEvent[] = []
  for (const e of events) {
    if (e.kind === 'reaction') {
      if (e.targetMessageId === null) continue
      const list = reactionsFor.get(e.targetMessageId) ?? []
      list.push(e)
      reactionsFor.set(e.targetMessageId, list)
    } else {
      timelineEvents.push(e)
    }
  }

  // One chronological stream, so a "tapped Get Started" sits where it happened
  // rather than above or below the whole conversation.
  type Row = { at: Date; message?: MessengerMessage; event?: MessengerConversationEvent }
  const stream: Row[] = [
    ...messages.map((m) => ({ at: m.timestamp, message: m })),
    // Only events at or after the oldest loaded message: an event older than the
    // history on screen would otherwise appear to precede nothing.
    ...timelineEvents
      .filter((e) => !messages[0] || e.occurredAt >= messages[0].timestamp)
      .map((e) => ({ at: e.occurredAt, event: e })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())

  // Day separators are decided over the WHOLE stream, so a separator is not
  // repeated when an older page happens to start on the same day.
  const rows = stream
    .map((r, i) => ({ r, newDay: i === 0 || formatDate(stream[i - 1].at) !== formatDate(r.at) }))
    .reverse()

  return (
    <div
      role='group'
      aria-label='הודעות השיחה'
      className='flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-4 py-3 bg-bg bg-[radial-gradient(var(--color-primary-soft)_1px,transparent_1px)] bg-size-[16px_16px]'
    >
      {rows.map(({ r, newDay }) => (
        <div key={r.message ? `m${r.message.id}` : `e${r.event!.id}`} className='mt-1.5'>
          {newDay && (
            <div className='flex justify-center pb-1.5 pt-2.5'>
              <span
                suppressHydrationWarning
                className='rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[10px] font-medium text-gray-500'
              >
                {formatDate(r.at)}
              </span>
            </div>
          )}
          {r.message ? (
            <MessengerBubble message={r.message} reactions={reactionsFor.get(r.message.id) ?? []} />
          ) : (
            <MessengerEventLine event={r.event!} />
          )}
        </div>
      ))}

      {/* Last in DOM order, so in a reversed column it sits at the visual TOP. */}
      {hasMore && (
        <div className='flex flex-col items-center gap-1 pb-2'>
          <button
            type='button'
            onClick={loadOlder}
            disabled={loading}
            className='rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-60'
          >
            {loading ? 'טוען הודעות קודמות…' : 'טען הודעות קודמות'}
          </button>
          {failed && (
            <p role='alert' className='text-[11px] text-error-text'>
              לא ניתן לטעון הודעות קודמות. נסה שוב.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
