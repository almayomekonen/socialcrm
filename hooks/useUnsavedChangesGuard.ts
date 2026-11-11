'use client'

import { useEffect } from 'react'

/**
 * Warn before the page is unloaded while a form holds unsaved changes.
 *
 * `beforeunload` only: it covers a reload, closing the tab and typing a new
 * address — the same guard `useQuestionnaireDraft` uses. In-app link clicks are
 * client-side navigations that the App Router offers no public way to block, and
 * intercepting them is deliberately out of scope (owner decision, 2026-11-11).
 *
 * The browser shows its own generic wording; a custom message is ignored by
 * every current browser, so none is set.
 */
export function useUnsavedChangesGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [active])
}
