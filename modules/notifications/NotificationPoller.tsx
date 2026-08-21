'use client'

import { isAccessDenied, markAccessDenied } from '@/lib/entitlement/pollGate'
import { useCallback } from 'react'
import { useAdaptivePoll } from '@/modules/inbox/client/useAdaptivePoll'
import { INBOX_RECOVERY_MS } from '@/lib/polling/syncFailure'
import type { NotificationFeedResponse } from './types'

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
export default function NotificationPoller({ onData }: { onData: (data: NotificationFeedResponse) => void }) {
  const poll = useCallback(async () => {
    // Reported so the server can classify presence honestly: a hidden tab is IDLE,
    // not ONLINE, and the server must not have to guess.
    const visible = typeof document === 'undefined' || !document.hidden
    let res: Response
    try {
      // A lapsed subscription is permanent until renewal — stop asking.
      if (isAccessDenied()) return
      res = await fetch(`/api/notifications/feed?visible=${visible ? '1' : '0'}`, { cache: 'no-store' })
    } catch {
      return { changed: false, failed: true }
    }
    if (!res.ok) {
      // 403 here is entitlement, not a network fault: never retry it.
      if (res.status === 403) markAccessDenied()
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
