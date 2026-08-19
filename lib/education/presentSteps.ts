import type { TourStep } from './types'

export type QueryFn = (selector: string) => Element | null

/** Bounded wait after navigation. Not a MutationObserver and not an open-ended poll. */
export const TOUR_TARGET_WAIT_MS = 1500

function defaultQuery(selector: string): Element | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(selector)
}

/**
 * Drop steps whose target is missing. A tour with no remaining steps must not
 * start — never throw, never highlight the body.
 */
export function presentSteps(steps: TourStep[], query: QueryFn = defaultQuery): TourStep[] {
  return steps.filter((step) => {
    if (!step.element) return true
    return query(step.element) != null
  })
}

export type WaitForTourTargetsOpts = {
  timeoutMs?: number
  query?: QueryFn
  now?: () => number
  /** Test seam. Production uses requestAnimationFrame. */
  schedule?: (cb: () => void) => unknown
  signal?: AbortSignal
}

/**
 * True when at least one step can be shown.
 * Immediate if targets already exist; otherwise rAF-polls until timeout.
 */
export function waitForTourTargets(steps: TourStep[], opts: WaitForTourTargetsOpts = {}): Promise<boolean> {
  const query = opts.query ?? defaultQuery
  if (presentSteps(steps, query).length > 0) return Promise.resolve(true)
  if (opts.signal?.aborted) return Promise.resolve(false)

  const timeoutMs = opts.timeoutMs ?? TOUR_TARGET_WAIT_MS
  const now = opts.now ?? Date.now
  const schedule =
    opts.schedule ??
    (typeof window !== 'undefined' ? (cb: () => void) => window.requestAnimationFrame(cb) : null)
  if (!schedule) return Promise.resolve(false)

  return new Promise((resolve) => {
    const started = now()
    let settled = false
    let handle: unknown

    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      if (typeof window !== 'undefined' && typeof handle === 'number') {
        window.cancelAnimationFrame(handle)
      }
      resolve(value)
    }

    const onAbort = () => finish(false)
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const tick = () => {
      if (presentSteps(steps, query).length > 0) {
        finish(true)
        return
      }
      if (now() - started >= timeoutMs) {
        finish(false)
        return
      }
      handle = schedule(tick)
    }

    handle = schedule(tick)
  })
}
