/**
 * A WhatsApp connect attempt that the page did not live to see the end of.
 *
 * Every other outcome is reported from `useEmbeddedSignup`'s promise. But a
 * customer who reloads, navigates away or closes the tab while Meta's window is
 * open ends the attempt with no promise left to settle — agency 156 did this
 * twice on 2026-09-24 and those attempts have no outcome at all. Reporting from
 * `pagehide` is unreliable (the request is cut off with the page), so the start
 * leaves a marker and the NEXT visit to a connect surface reports it.
 *
 * sessionStorage, not localStorage: the marker belongs to one tab. It survives
 * that tab's reload or navigation, and no other tab can read — and wrongly
 * report — an attempt that is still open elsewhere. Closing the tab loses it;
 * that attempt cannot be reported.
 *
 * Pure over a Storage-like object so it runs in tests without a browser, and it
 * never throws: storage can be blocked, and analytics must not break a page.
 */

const KEY = 'socialcrm:wa-connect-pending'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function markPendingAttempt(storage: StorageLike, now: number): void {
  try {
    storage.setItem(KEY, String(now))
  } catch {
    // Storage blocked: this attempt simply cannot be reported if abandoned.
  }
}

export function clearPendingAttempt(storage: StorageLike): void {
  try {
    storage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}

/** The abandoned attempt, if one was left behind — reported once, then cleared. */
export function takeAbandonedAttempt(storage: StorageLike, now: number): { sinceStartMs: number } | null {
  try {
    const raw = storage.getItem(KEY)
    if (raw === null) return null
    storage.removeItem(KEY)
    const startedAt = Number(raw)
    if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now) return null
    return { sinceStartMs: now - startedAt }
  } catch {
    return null
  }
}

/** This tab's sessionStorage when reachable; null on the server or when blocked. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}
