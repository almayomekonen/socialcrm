'use client'

import { useEffect, useRef, useState } from 'react'
import { clearLeadScopeParams, withLeadSearch } from '@/lib/leads/leadScope'
import { STATUS_STYLES } from '../LeadStatusCell'

const SEARCH_DEBOUNCE_MS = 300

type Router = { push: (href: any, opts?: any) => void; replace: (href: any, opts?: any) => void }

/**
 * Picking a suggestion searches for that lead BY NAME — it does not open a
 * private one-record workspace. `firstName lastName` is exactly what the
 * server's `q` matcher tests against `name`/`firstName`/`lastName`.
 *
 * Never `details`: that column is generated as
 * `firstName || ' ' || lastName || ' (' || idNum || ')'`, so committing it
 * would put a national ID in the URL — shareable, loggable — and still match
 * nothing, because `q` does not search `details`.
 */
export function suggestionName(client) {
  return [client?.firstName, client?.lastName].filter(Boolean).join(' ').trim()
}

/**
 * LIVE SEARCH. The table is the result: typing narrows it, and the URL is how
 * that narrowing reaches the server. `q` is written on a ~300ms debounce, so a
 * fast typist costs one render, not one per character.
 *
 * `paramsRef` and `searchTermRef` exist because the debounced callback would
 * otherwise close over a stale render's values and rebuild the URL from what
 * the workspace looked like several keystrokes ago.
 */
export function useLeadSearch({ router, searchParams, searchTerm }: { router: Router; searchParams: URLSearchParams | { toString(): string }; searchTerm: string }) {
  const paramsRef = useRef(searchParams.toString())
  useEffect(() => {
    paramsRef.current = searchParams.toString()
  }, [searchParams])

  /** The term WE last put in the URL. Anything else arriving is external. */
  const searchTermRef = useRef(searchTerm)
  /** The most recent text the box produced. Guards against stale debounce ticks. */
  const pendingRef = useRef(searchTerm)

  /**
   * WHAT THE BOX SHOWS — and the reason it is a separate value from `searchTerm`.
   *
   * The input is uncontrolled, so it only gets overwritten when this changes.
   * It changes ONLY on external navigation: mount, back/forward, the eraser
   * link. It deliberately does NOT change when the URL is merely echoing a
   * search we just issued — by the time that echo lands, the rep has usually
   * typed two more characters, and writing the older term back would eat them.
   */
  const [boxTerm, setBoxTerm] = useState(searchTerm)
  useEffect(() => {
    if (searchTerm === searchTermRef.current) return // our own echo — the box is already ahead
    searchTermRef.current = searchTerm
    pendingRef.current = searchTerm
    setBoxTerm(searchTerm)
  }, [searchTerm])

  /**
   * HISTORY: exactly one entry per search session.
   *
   * Unfiltered → filtered pushes, so one Back returns the rep to their whole
   * workspace. Every later change — including clearing — replaces, so Back never
   * walks backwards through "ספי ברה", "ספי בר", "ספי ב"…
   */
  function applySearch(term: string) {
    const next = term.trim()
    // A tick from a keystroke the user has already moved past.
    if (next !== pendingRef.current.trim()) return
    if (next === searchTermRef.current) return

    const mode = searchTermRef.current ? 'replace' : 'push'
    searchTermRef.current = next
    goTo(withLeadSearch(new URLSearchParams(paramsRef.current), next), mode)
  }

  /**
   * The debounce is owned here rather than taken from the shared helper because
   * that one cannot be cancelled: a timer left running past unmount would fire a
   * navigation at a page the rep has already left.
   */
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    },
    [],
  )

  function onSearchChange(text: string) {
    pendingRef.current = text
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    // Clearing is immediate — waiting 300ms to get your workspace back feels
    // broken. Any tick still in flight is dropped by the guard in applySearch.
    if (!text.trim()) return applySearch('')
    searchTimerRef.current = setTimeout(() => applySearch(text), SEARCH_DEBOUNCE_MS)
  }

  /** Enter in the box: commit the typed text now. */
  function submitText(text: string) {
    pendingRef.current = text
    applySearch(text)
  }

  function pickSuggestion(client) {
    const name = suggestionName(client)
    if (!name) return
    // An explicit pick is a decision, not a keystroke — it skips the debounce.
    pendingRef.current = name
    applySearch(name)
  }

  /**
   * The empty state's way out. Wider than clearing the box: the screen can also
   * be empty because of a saved list or a `?view=due` arrival from the
   * dashboard, and a button that lifted only the search would visibly do
   * nothing there.
   */
  function clearAllScope() {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    pendingRef.current = ''
    searchTermRef.current = ''
    goTo(clearLeadScopeParams(new URLSearchParams(paramsRef.current)), 'replace')
  }

  function goTo(params: URLSearchParams, mode: 'push' | 'replace') {
    const next = params.toString()
    const href = (next ? `?${next}` : '?') as any
    if (mode === 'push') router.push(href, { scroll: false })
    else router.replace(href, { scroll: false })
  }

  return { boxTerm, onSearchChange, submitText, pickSuggestion, clearAllScope }
}

/**
 * THE TAB MUST NOT TWITCH WHILE TYPING.
 *
 * The table filters rows by the active status tab, so a rep on "חדש" whose
 * search only matches leads in "בטיפול" would stare at an empty table over a
 * result set that does contain their lead. The tab therefore follows the
 * results — but only when it has to, and only until the rep says otherwise:
 *
 *   · the current tab still has matches  → leave it alone
 *   · the rep has clicked a tab during this search → never override them again
 *   · otherwise → move to the first status that has matches
 *
 * Clearing the search re-arms it for the next one.
 */
export function useSearchTabFollow({
  leads,
  searchTerm,
  mergedState,
  setActiveTab,
}: {
  leads: boolean
  searchTerm: string
  mergedState: { status?: string | null }[]
  setActiveTab: (next: string | ((current: string) => string)) => void
}) {
  const manualTabRef = useRef(false)
  function selectTab(status: string) {
    manualTabRef.current = true
    setActiveTab(status)
  }

  useEffect(() => {
    if (!leads) return
    if (!searchTerm) {
      manualTabRef.current = false
      return
    }
    if (manualTabRef.current || mergedState.length === 0) return
    setActiveTab((current) => {
      if (mergedState.some((l) => l.status === current)) return current
      return Object.keys(STATUS_STYLES).find((k) => mergedState.some((l) => l.status === k)) ?? current
    })
  }, [searchTerm, leads, mergedState])

  return selectTab
}
