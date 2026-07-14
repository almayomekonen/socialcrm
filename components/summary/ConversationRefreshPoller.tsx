'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  /** Milliseconds between router.refresh() calls. */
  intervalMs?: number
}

/**
 * RSC companion refresh for inbox intel / smartCounts.
 * When delta sync is on, callers pass a slower interval (60s) so list/thread
 * stay on InboxSyncLoop while intel panels still refresh. Visibility-gated.
 */
export default function ConversationRefreshPoller({ intervalMs = 5000 }: Props) {
  const router = useRouter()

  useEffect(() => {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return

    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer !== null) return
      timer = setInterval(() => {
        router.refresh()
      }, intervalMs)
    }

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) stop()
      else start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stop()
    }
  }, [router, intervalMs])

  return null
}
