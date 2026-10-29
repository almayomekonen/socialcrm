'use client'

import { useEffect, useRef, useState } from 'react'
import { formatBusinessDate as formatDate } from '@/lib/today/time'
import { loadOlderMessengerMessages } from '../actions'
import type { MessengerConversationEvent, MessengerMessage } from '../types'
import MessengerBubble from './MessengerBubble'
import MessengerEventLine from './MessengerEventLine'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

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
 * readable before any JavaScript runs.
 *
 * WHY IT ACCUMULATES RATHER THAN CONCATENATING. `initial` is the newest page,
 * and the inbox re-renders it every 10 seconds. As new messages arrive, older
 * ones drop off the bottom of that page — so holding only (fetched-earlier +
 * current page) loses exactly the messages that fell between them, tearing a
 * silent hole in the middle of a conversation the rep is reading. Everything
 * ever seen is therefore kept, merged with the current page, deduped by id and
 * re-sorted. The cost is memory proportional to what was actually read.
 */
export default function MessengerMessageList({
  conversationId,
  initial,
  hasMoreInitially,
  events = [],
  locale = 'he',
}: {
  conversationId: number
  /** Oldest-first, as the server produced it. */
  initial: MessengerMessage[]
  hasMoreInitially: boolean
  /** Postbacks, referrals and reactions for this conversation, oldest-first. */
  events?: MessengerConversationEvent[]
  /** The page's interface language (server-resolved, so SSR and hydration agree). */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const [seen, setSeen] = useState<MessengerMessage[]>([])
  const [hasMore, setHasMore] = useState(hasMoreInitially)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const conversation = useRef(conversationId)

  // Switching conversations must not carry one thread's history into another.
  useEffect(() => {
    if (conversation.current === conversationId) return
    conversation.current = conversationId
    setSeen([])
    setHasMore(hasMoreInitially)
    setFailed(false)
  }, [conversationId, hasMoreInitially])

  // Absorb each server page as it arrives, so messages that later fall off the
  // bottom of the newest page are still held. Returning `prev` unchanged when
  // there is nothing new keeps this from re-rendering on every poll.
  useEffect(() => {
    setSeen((prev) => {
      const known = new Set(prev.map((m) => m.id))
      const added = initial.filter((m) => !known.has(m.id))
      return added.length > 0 ? [...prev, ...added] : prev
    })
  }, [initial])

  // Everything read so far, plus the current page. Deduped by id (the server
  // page and the accumulator overlap by design) and ordered the same way the
  // server orders: event time, then id — which is total even when Meta gives two
  // messages the same second.
  const byId = new Map<number, MessengerMessage>()
  for (const m of seen) byId.set(m.id, m)
  // The server's copy wins: it carries fresher delivery/read state.
  for (const m of initial) byId.set(m.id, m)
  const messages = [...byId.values()].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id,
  )
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
      // Appended; the merge above dedupes and orders, so a double-tap racing two
      // loads onto the same cursor cannot produce a repeat.
      setSeen((prev) => [...prev, ...result.messages])
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
      aria-label={t('inbox.messenger.thread.messages')}
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
            <MessengerBubble message={r.message} reactions={reactionsFor.get(r.message.id) ?? []} locale={locale} />
          ) : (
            <MessengerEventLine event={r.event!} locale={locale} />
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
            {loading ? t('inbox.messenger.thread.loadingOlder') : t('inbox.messenger.thread.loadOlder')}
          </button>
          {failed && (
            <p role='alert' className='text-[11px] text-error-text'>
              {t('inbox.messenger.thread.loadOlderFailed')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
