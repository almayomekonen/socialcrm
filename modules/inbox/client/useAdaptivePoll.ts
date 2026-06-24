'use client'

import { useEffect, useRef } from 'react'
import { nextInterval, type PollBand } from './pollSchedule'

export interface UseAdaptivePollOpts {
  focusedMs?: PollBand
  hiddenMs?: PollBand
  maxIdle?: number
  enabled?: boolean
}

export function useAdaptivePoll(pollFn: () => Promise<{ changed: boolean }>, opts: UseAdaptivePollOpts = {}): void {
  const { focusedMs = [3500, 5000], hiddenMs = [30000, 60000], maxIdle = 4, enabled = true } = opts
  const pollRef = useRef(pollFn)
  pollRef.current = pollFn
  const idleStreak = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = () => {
      if (cancelled) return
      const ms = nextInterval({
        hidden: typeof document !== 'undefined' && document.hidden,
        idleStreak: idleStreak.current,
        focusedMs,
        hiddenMs,
        maxIdle,
      })
      timer = setTimeout(tick, ms)
    }

    const tick = async () => {
      if (cancelled) return
      if (inFlight.current) {
        schedule()
        return
      }
      inFlight.current = true
      try {
        const { changed } = await pollRef.current()
        idleStreak.current = changed ? 0 : idleStreak.current + 1
      } catch {
        idleStreak.current += 1
      } finally {
        inFlight.current = false
        schedule()
      }
    }

    const onVisibility = () => {
      if (!document.hidden) {
        idleStreak.current = 0 // snap to fast cadence on focus
        if (timer) clearTimeout(timer)
        void tick()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    timer = setTimeout(tick, 500) // first tick shortly after mount

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // depend on primitive band values so inline-array callers don't thrash the effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, focusedMs[0], focusedMs[1], hiddenMs[0], hiddenMs[1], maxIdle])
}
