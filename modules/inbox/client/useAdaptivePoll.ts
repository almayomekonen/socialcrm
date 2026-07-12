'use client'

import { useEffect, useRef } from 'react'
import { nextInterval, type PollBand } from '@/lib/polling/pollSchedule'
import {
  INBOX_RECOVERY_MS,
  nextConsecutiveFailures,
  scheduleDelayAfterPoll,
} from '@/lib/polling/syncFailure'

export type AdaptivePollResult = { changed: boolean; failed?: boolean }

export interface UseAdaptivePollOpts {
  focusedMs?: PollBand
  hiddenMs?: PollBand
  maxIdle?: number
  enabled?: boolean
  /** Fixed delay while consecutive transport/HTTP failures are ongoing (Wave A6). */
  recoveryMs?: number
  /** Called whenever consecutive failure count changes (0 = healthy). */
  onConsecutiveFailures?: (failures: number) => void
  /** Filled with a function that clears the timer and runs an immediate tick (Retry). */
  retryRef?: { current: (() => void) | null }
}

export function useAdaptivePoll(
  pollFn: () => Promise<AdaptivePollResult>,
  opts: UseAdaptivePollOpts = {},
): void {
  const {
    focusedMs = [3500, 5000],
    hiddenMs = [30000, 60000],
    maxIdle = 4,
    enabled = true,
    recoveryMs = INBOX_RECOVERY_MS,
    onConsecutiveFailures,
    retryRef,
  } = opts
  const pollRef = useRef(pollFn)
  pollRef.current = pollFn
  const onFailRef = useRef(onConsecutiveFailures)
  onFailRef.current = onConsecutiveFailures
  const idleStreak = useRef(0)
  const consecutiveFailures = useRef(0)
  const inFlight = useRef(false)
  const recovering = useRef(false)

  useEffect(() => {
    if (!enabled) {
      consecutiveFailures.current = 0
      recovering.current = false
      onFailRef.current?.(0)
      if (retryRef) retryRef.current = null
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = (failed: boolean) => {
      if (cancelled) return
      const idleMs = nextInterval({
        hidden: typeof document !== 'undefined' && document.hidden,
        idleStreak: idleStreak.current,
        focusedMs,
        hiddenMs,
        maxIdle,
      })
      const ms = scheduleDelayAfterPoll({ failed, recoveryMs, idleMs })
      timer = setTimeout(tick, ms)
    }

    const tick = async () => {
      if (cancelled) return
      if (inFlight.current) {
        schedule(recovering.current)
        return
      }
      inFlight.current = true
      let failed = false
      let changed = false
      try {
        const result = await pollRef.current()
        failed = !!result.failed
        changed = !!result.changed && !failed
      } catch {
        failed = true
      } finally {
        inFlight.current = false
        consecutiveFailures.current = nextConsecutiveFailures(consecutiveFailures.current, failed)
        recovering.current = failed
        onFailRef.current?.(consecutiveFailures.current)
        if (!failed) {
          idleStreak.current = changed ? 0 : idleStreak.current + 1
        }
        // Errors must NOT increase idleStreak (recovery band owns outage cadence).
        schedule(failed)
      }
    }

    const retryNow = () => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      void tick()
    }
    if (retryRef) retryRef.current = retryNow

    const onVisibility = () => {
      if (!document.hidden) {
        idleStreak.current = 0
        if (timer) clearTimeout(timer)
        void tick()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    timer = setTimeout(tick, 500)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      if (retryRef) retryRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, focusedMs[0], focusedMs[1], hiddenMs[0], hiddenMs[1], maxIdle, recoveryMs])
}
