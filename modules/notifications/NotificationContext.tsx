'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { useAdaptivePoll } from '@/modules/inbox/client/useAdaptivePoll'
import { INBOX_RECOVERY_MS } from '@/lib/polling/syncFailure'
import { AWARENESS_OWNED_CATEGORIES, feedSignature, selectToastable } from './surface'
import type { NotificationFeedItem, NotificationFeedResponse, WhileYouWereAway } from './types'
import type { Presence } from '@/lib/notifications/types'

/**
 * NotificationContext — the single client-side owner of notification state.
 *
 * ARCHITECTURE (spec §13.1, §13.2):
 *
 *   /api/notifications/feed  →  NotificationContext  →  existing toast()
 *          (database)              (session state)        (existing UI)
 *
 * The database is the source of truth. This context holds a CACHE of the last feed
 * response plus exactly two things the server cannot know: when this browser
 * session mounted, and which rows it has already presented. Everything durable —
 * unread, seen, read — is a database fact that arrives with the next poll.
 *
 * It deliberately owns NOTIFICATION state only. `unreadConversationCount` travels
 * on the feed but is NOT exposed here and NOT wired to the nav badge: that badge
 * keeps its existing AwarenessContext source until P2.6, so P2.2 cannot regress it
 * (P2.0 discovery §11.1). Two counts, two owners, no reinterpretation.
 *
 * NO SECOND SYSTEM. Polling is `useAdaptivePoll`, health reporting is
 * `CrmSyncHealthContext`, and toasting is the existing `toast()` — all reused
 * unchanged. Nothing here is a new framework.
 */

type NotificationContextValue = {
  /** false ⇒ the feature is off; every field below is inert and nothing polls. */
  enabled: boolean
  /** Unread NOTIFICATION rows. Never the conversation count. */
  unreadCount: number
  items: NotificationFeedItem[]
  whileYouWereAway: WhileYouWereAway | null
  presence: Presence
  /** Stamp seenAt for rows a surface actually rendered (P2.3 dropdown calls this). */
  markSeen: (ids: number[]) => void
  markRead: (ids: number[]) => void
  markAllRead: () => void
}

const EMPTY: NotificationContextValue = {
  enabled: false,
  unreadCount: 0,
  items: [],
  whileYouWereAway: null,
  presence: 'offline',
  markSeen: () => {},
  markRead: () => {},
  markAllRead: () => {},
}

const NotificationContext = createContext<NotificationContextValue>(EMPTY)

export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext)
}

/** The bell badge reads this (P2.3). Separate from the nav conversation badge. */
export function useNotificationUnreadCount(): number {
  return useContext(NotificationContext).unreadCount
}

type FeedState = {
  unreadCount: number
  items: NotificationFeedItem[]
  whileYouWereAway: WhileYouWereAway | null
  presence: Presence
}

const INITIAL: FeedState = { unreadCount: 0, items: [], whileYouWereAway: null, presence: 'offline' }

export function NotificationProvider({
  /** From the server layout: NOTIFICATIONS_ENABLED && agency allowlisted. */
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const router = useRouter()
  const [state, setState] = useState<FeedState>(INITIAL)

  /**
   * Only arrivals strictly after mount may toast. Pre-existing unread is a count,
   * never a flood — the same rule AwarenessContext already applies.
   *
   * The boundary is held in SERVER time, not browser time, because `createdAt`
   * comes from the server and the two clocks are not the same clock. A browser ten
   * minutes behind would otherwise read its whole unread backlog as "arrived after
   * mount" and toast all of it on load — the exact flood this gate exists to
   * prevent, triggered by a wrong clock rather than by real activity. So the mount
   * instant is recorded on the browser clock and translated once, using the
   * `serverTime` the first response carries.
   */
  const mountedAtClient = useRef<number>(Date.now())
  const boundary = useRef<string | null>(null)
  /** Ids presented in THIS session. Covers the gap before the seen-stamp lands. */
  const toasted = useRef<Set<number>>(new Set())
  /** Ids already sent to the seen endpoint, so live surfaces do not re-post them. */
  const stampedSeen = useRef<Set<number>>(new Set())
  /** Last applied signature, so an unchanged poll does not re-render consumers. */
  const signature = useRef<string>('')

  const post = useCallback(async (path: string, body: unknown) => {
    try {
      await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
    } catch {
      /**
       * Swallowed on purpose. A failed seen/read stamp must never break the app or
       * surface an error: the next poll re-reads the true state from the database,
       * so the worst case is a row that stays unread slightly longer. The session
       * guard still prevents a repeat toast in the meantime.
       */
    }
  }, [])

  /**
   * Stamp seenAt for rows a surface actually presented.
   *
   * De-duplicated per session because surfaces are LIVE: the dropdown stays open
   * across polls and re-reports the rows it is still showing. The write is already
   * idempotent server-side (`WHERE "seenAt" IS NULL`), so this is about not making
   * a request every few seconds to say nothing new — and it lives here, in the one
   * state owner, so every surface gets it rather than each re-inventing it.
   *
   * Ids arriving after a stamp are still sent: only ones already sent are dropped.
   */
  const markSeen = useCallback(
    (ids: number[]) => {
      if (!enabled || !ids.length) return
      const fresh = ids.filter((id) => !stampedSeen.current.has(id))
      if (!fresh.length) return
      for (const id of fresh) stampedSeen.current.add(id)
      void post('/api/notifications/seen', { ids: fresh })
    },
    [enabled, post],
  )

  const markRead = useCallback(
    (ids: number[]) => {
      if (!enabled || !ids.length) return
      const idSet = new Set(ids)
      // Optimistic, then reconciled by the next poll. The database stays
      // authoritative; this only removes the lag between click and feedback.
      setState((prev) => ({
        ...prev,
        unreadCount: Math.max(0, prev.unreadCount - prev.items.filter((i) => idSet.has(i.id) && !i.readAt).length),
        items: prev.items.map((i) => (idSet.has(i.id) && !i.readAt ? { ...i, readAt: new Date().toISOString() } : i)),
      }))
      signature.current = ''
      void post('/api/notifications/read', { ids })
    },
    [enabled, post],
  )

  const markAllRead = useCallback(() => {
    if (!enabled) return
    const now = new Date().toISOString()
    setState((prev) => ({
      ...prev,
      unreadCount: 0,
      items: prev.items.map((i) => (i.readAt ? i : { ...i, readAt: now })),
    }))
    signature.current = ''
    void post('/api/notifications/read', { all: true })
  }, [enabled, post])

  /**
   * Apply one feed response: refresh state, then surface genuinely new rows.
   *
   * ORDER MATTERS. State is applied first so a toast can never be shown for a row
   * the UI has not yet been told about.
   */
  const applyFeed = useCallback(
    (data: NotificationFeedResponse) => {
      const next = feedSignature({
        unreadNotificationCount: data.unreadNotificationCount,
        presence: data.presence,
        items: data.items,
        whileYouWereAwayTotal: data.whileYouWereAway?.total ?? null,
      })
      if (next !== signature.current) {
        signature.current = next
        setState({
          unreadCount: data.unreadNotificationCount,
          items: data.items,
          whileYouWereAway: data.whileYouWereAway,
          presence: data.presence,
        })
      }

      if (boundary.current === null) {
        /**
         * Translate the mount instant into server time, once. The measured skew
         * also absorbs the response's network latency, which biases the boundary a
         * few hundred milliseconds early — irrelevant against the minutes-scale
         * question this gate actually answers.
         */
        const skewMs = new Date(data.serverTime).getTime() - Date.now()
        boundary.current = new Date(mountedAtClient.current + skewMs).toISOString()
      }

      const fresh = selectToastable({
        items: data.items,
        mountedAt: boundary.current,
        alreadyToasted: toasted.current,
        suppressedCategories: AWARENESS_OWNED_CATEGORIES,
      })
      if (!fresh.length) return

      /**
       * Mark as toasted BEFORE showing, so a poll that overlaps the toast cannot
       * select the same rows again.
       */
      for (const item of fresh) toasted.current.add(item.id)

      if (fresh.length === 1) {
        const item = fresh[0]
        toast('message', item.title, 6000, () => router.push(item.deepLink))
      } else {
        /**
         * ONE summary, never N toasts: `toast()` is single-slot (a second call
         * replaces the first), so surfacing several individually would show only
         * the last one and flicker through the rest. Triage, never dump.
         *
         * No click target yet — `/notifications` arrives in P2.5, and linking to a
         * route that does not exist would be worse than not linking at all.
         */
        toast('message', `${fresh.length} התראות חדשות`, 6000)
      }

      /**
       * seenAt is stamped HERE and only here in P2.2: the app has genuinely
       * surfaced these rows. It is NOT stamped because the feed returned them
       * (spec §8.2) — that distinction is what keeps "While you were away"
       * truthful for a user who was pushed but never looked.
       */
      markSeen(fresh.map((i) => i.id))
    },
    [markSeen, router],
  )

  const value = useMemo<NotificationContextValue>(
    () => ({
      enabled,
      unreadCount: state.unreadCount,
      items: state.items,
      whileYouWereAway: state.whileYouWereAway,
      presence: state.presence,
      markSeen,
      markRead,
      markAllRead,
    }),
    [enabled, state, markSeen, markRead, markAllRead],
  )

  return (
    <NotificationContext.Provider value={value}>
      {enabled ? <NotificationPoller onData={applyFeed} /> : null}
      {children}
    </NotificationContext.Provider>
  )
}

/**
 * The feed loop. One per app shell.
 *
 * IT DOES NOT YIELD ON /inbox, and that is a deliberate difference from
 * AwarenessPoller, which does. Awareness can yield there because InboxSyncLoop
 * feeds the same context; this loop has no such substitute, and it is the ONLY
 * writer of user_presence (spec §7.2). Yielding would mean a user working in the
 * inbox stops stamping presence, classifies OFFLINE within ten minutes, and — once
 * P3 lands — gets pushed at while looking at the screen.
 *
 * While both systems are alive (P2.2–P2.5) an enabled agency runs two loops. That
 * is a temporary, flag-gated cost of migrating without a cutover; P2.6 removes the
 * awareness one.
 */
function NotificationPoller({ onData }: { onData: (data: NotificationFeedResponse) => void }) {
  const poll = useCallback(async () => {
    // Reported so the server can classify presence honestly: a hidden tab is IDLE,
    // not ONLINE, and the server must not have to guess.
    const visible = typeof document === 'undefined' || !document.hidden
    let res: Response
    try {
      res = await fetch(`/api/notifications/feed?visible=${visible ? '1' : '0'}`, { cache: 'no-store' })
    } catch {
      return { changed: false, failed: true }
    }
    if (!res.ok) {
      console.warn('[notifications.feed]', { status: res.status })
      return { changed: false, failed: true }
    }
    const data = (await res.json()) as NotificationFeedResponse
    onData(data)
    // `changed` drives the adaptive backoff. Unread count is the honest signal:
    // the item page is identical on most polls, so using its length would pin the
    // loop to its fastest cadence forever.
    return { changed: data.unreadNotificationCount > 0, failed: false }
  }, [onData])

  /**
   * No `CrmSyncHealth` reporting, deliberately. `CrmSyncSource` is a closed union
   * whose only consumer is `CrmSyncBanner`, which each page opts into explicitly —
   * so adding a member would log "banner open" for a banner that can never appear.
   * The recovery band (`recoveryMs`) does its work without it, and a feed outage
   * has no user-facing recovery action in P2.2: notifications are additive, and the
   * next successful poll restores the true state from the database.
   */
  useAdaptivePoll(poll, { recoveryMs: INBOX_RECOVERY_MS })

  return null
}
