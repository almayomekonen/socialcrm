'use client'

import { isAccessDenied, markAccessDenied } from '@/lib/entitlement/pollGate'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { useAdaptivePoll } from '@/modules/inbox/client/useAdaptivePoll'
import { useCrmSyncHealth } from '@/lib/polling/CrmSyncHealthContext'
import { INBOX_RECOVERY_MS } from '@/lib/polling/syncFailure'
import type { AwarenessItem } from './types'

export type AwarenessCounts = { whatsappUnread: number }

type AwarenessContextValue = {
  /** Live unread count, or null when delta-sync is disabled (badge falls back to the server prop). */
  whatsappUnread: number | null
  /**
   * The single entry point the global awareness poll (this file) calls off-inbox:
   * updates the count AND toasts genuinely-new arrivals.
   */
  mergeAwareness: (counts: AwarenessCounts, items: AwarenessItem[]) => void
  /**
   * Badge-only update the inbox /sync loop (T5) calls: on /inbox the live list IS
   * the signal, so we move the badge but never toast (no redundant on-screen alert).
   */
  setCount: (whatsappUnread: number) => void
}

const AwarenessContext = createContext<AwarenessContextValue>({
  whatsappUnread: null,
  mergeAwareness: () => {},
  setCount: () => {},
})

export function useAwareness(): AwarenessContextValue {
  return useContext(AwarenessContext)
}

/** Nav badge reads this; null means "no live data" → caller uses the server-rendered count. */
export function useAwarenessCount(): number | null {
  return useContext(AwarenessContext).whatsappUnread
}

export function AwarenessProvider({
  enabled,
  initialUnread,
  children,
}: {
  enabled: boolean
  initialUnread: number
  children: ReactNode
}) {
  const router = useRouter()
  const [whatsappUnread, setWhatsappUnread] = useState<number | null>(enabled ? initialUnread : null)
  // Keys (conversationId:at) already toasted — prevents duplicate toasts across polls.
  const seen = useRef<Set<string>>(new Set())
  // Only arrivals strictly after mount toast; pre-existing unread shows as a count,
  // never a flood of toasts on load (care-charter: proportional, never overwhelming).
  const mountedAt = useRef<string>(new Date().toISOString())

  const mergeAwareness = useCallback(
    (counts: AwarenessCounts, items: AwarenessItem[]) => {
      setWhatsappUnread(counts.whatsappUnread)
      const fresh = items.filter((it) => {
        const key = `${it.conversationId}:${it.at}`
        if (seen.current.has(key)) return false
        seen.current.add(key)
        return it.at > mountedAt.current
      })
      if (fresh.length === 1) {
        const it = fresh[0]
        toast('message', `הודעה חדשה מ${it.contactName}`, 6000, () =>
          router.push(`/inbox?conversation=${it.conversationId}`),
        )
      } else if (fresh.length > 1) {
        // Triage, never dump: one calm summary, opens the inbox.
        toast('message', `${fresh.length} הודעות חדשות`, 6000, () => router.push('/inbox'))
      }
    },
    [router],
  )

  const setCount = useCallback((n: number) => setWhatsappUnread(n), [])

  return (
    <AwarenessContext.Provider value={{ whatsappUnread, mergeAwareness, setCount }}>
      {enabled ? <AwarenessPoller onData={mergeAwareness} /> : null}
      {children}
    </AwarenessContext.Provider>
  )
}

/**
 * The single global awareness loop — runs EVERYWHERE the app shell is mounted
 * EXCEPT /inbox, where the inbox /sync loop (T5) feeds the same mergeAwareness.
 * That keeps exactly one poll active at a time.
 */
function AwarenessPoller({ onData }: { onData: AwarenessContextValue['mergeAwareness'] }) {
  const pathname = usePathname()
  const isInbox = pathname?.startsWith('/inbox') ?? false
  const since = useRef<string>(new Date().toISOString())
  const { report } = useCrmSyncHealth()
  const retryRef = useRef<(() => void) | null>(null)

  const poll = useCallback(async () => {
    let res: Response
    try {
      // A lapsed subscription is permanent until renewal — stop asking.
      if (isAccessDenied()) return
      res = await fetch(`/api/inbox/awareness?since=${encodeURIComponent(since.current)}`, { cache: 'no-store' })
    } catch {
      return { changed: false, failed: true }
    }
    if (!res.ok) {
      // 403 here is entitlement, not a network fault: never retry it.
      if (res.status === 403) markAccessDenied()
      console.warn('[inbox.awareness]', { status: res.status })
      return { changed: false, failed: true }
    }
    const data = (await res.json()) as { counts: AwarenessCounts; items: AwarenessItem[]; serverTime: string }
    onData(data.counts, data.items)
    since.current = data.serverTime
    return { changed: data.items.length > 0, failed: false }
  }, [onData])

  useAdaptivePoll(poll, {
    enabled: !isInbox,
    recoveryMs: INBOX_RECOVERY_MS,
    retryRef,
    onConsecutiveFailures: (failures) => {
      report('awareness', failures, retryRef.current)
    },
  })

  useEffect(() => {
    if (isInbox) report('awareness', 0, null)
  }, [isInbox, report])

  return null
}
