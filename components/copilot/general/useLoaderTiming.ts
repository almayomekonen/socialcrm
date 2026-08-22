'use client'

import { useCallback, useState } from 'react'

/**
 * Honest loader timing for the General-Mode panel.
 *
 * Extracted VERBATIM from GeneralModePanel — architecture-rules §8: the panel was
 * already past the 250-line soft limit, so a change that adds to it must extract.
 * Timing policy is a separate concern from rendering the conversation. Behaviour is
 * unchanged: same constants, same sequence.
 *
 * Sub-DELAY answers never show a loader (no flash). Once shown it holds for MIN
 * (no strobe). The pulse escalates to step text only after ESCALATE — a threshold
 * no deterministic path reaches, so the text is always honest.
 */
const LOADER_DELAY_MS = 150
const LOADER_MIN_MS = 350
export const LOADER_ESCALATE_MS = 1500

export function useLoaderTiming() {
  const [showLoader, setShowLoader] = useState(false)
  const [loaderEscalates, setLoaderEscalates] = useState(false)

  // Show the loader only if the work outlives DELAY; once shown, hold it MIN so it
  // never strobes. The awaited value resolves only after the min hold, smoothing the
  // hand-off to the answer.
  const withLoader = useCallback(async function <T>(escalates: boolean, run: () => Promise<T>): Promise<T> {
    let shown = false
    let shownAt = 0
    const showTimer = setTimeout(() => {
      shown = true
      shownAt = Date.now()
      setLoaderEscalates(escalates)
      setShowLoader(true)
    }, LOADER_DELAY_MS)
    try {
      return await run()
    } finally {
      clearTimeout(showTimer)
      if (shown) {
        const remaining = LOADER_MIN_MS - (Date.now() - shownAt)
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
      }
      setShowLoader(false)
    }
  }, [])

  return { showLoader, loaderEscalates, withLoader }
}
