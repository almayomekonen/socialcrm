'use client'

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { toast } from '@/lib/toast'
import { type LeadFilters } from '@/modules/leads/filters'
import { relativeTime } from '@/modules/inbox/mobile/relativeTime'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { loadMoreMobileLeads } from '@/actions/leads/loadMoreMobileLeads'
import { followUpBadge } from './followUpBadge'
import type { LeadListCard } from './leadSelection'

/**
 * The phone list's rows and its "טען עוד" batches (extracted from
 * `LeadListMobileClient`, no behaviour change).
 *
 * BATCH LOADING, NOT PAGE SWITCHING. `/leads` on a phone used `?page=`, which
 * REPLACED the visible list: reaching lead 31 meant losing leads 1-30 and the
 * scroll position. Batches accumulate here instead — the server still renders
 * batch 1, and every later batch is appended.
 */
export function useLeadListBatches({
  initialCards,
  filters,
  hasMore,
  page,
  nowMs,
  dayStartMs,
  pendingRef,
  locale = 'he',
}: {
  initialCards: LeadListCard[]
  filters: LeadFilters
  hasMore: boolean
  page: number
  nowMs: number
  dayStartMs: number
  /** Optimistic mutations in flight: while > 0 a new server list does not replace the rows. */
  pendingRef: MutableRefObject<number>
  /** The interface language of the appended rows' badges and toast (Hebrew by default). */
  locale?: UiLocale
}) {
  const [items, setItems] = useState(initialCards)
  const [batch, setBatch] = useState(page)
  const [more, setMore] = useState(hasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingRef = useRef(false)
  /**
   * Identifies WHICH result set a batch belongs to. A request started before the
   * user changed the search is still in flight when the new first batch renders;
   * without this its rows would be appended to a list they do not belong to.
   */
  const requestKeyRef = useRef('')
  const itemsRef = useRef(items)
  itemsRef.current = items

  /**
   * `loadingRef` — not `loadingMore` — is the duplicate guard: state updates are
   * async, so two taps in the same tick would both see `loadingMore === false`
   * and fire two identical requests.
   */
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !more) return
    loadingRef.current = true
    setLoadingMore(true)
    const startedFor = `${filters.q}|${filters.status.join(',')}`
    requestKeyRef.current = startedFor
    try {
      const next = await loadMoreMobileLeads(filters, batch + 1)
      // Filters changed while this was in flight — discard, do not append.
      if (requestKeyRef.current !== startedFor) return
      // Stamp badges from the SERVER's clock (`nowMs`), never a fresh client
      // read — the same rule the first batch follows (architecture-rules.md §11).
      const cards = next.rows.map((lead) => ({
        ...lead,
        followUp: followUpBadge(lead.nextFollowUpAt, nowMs, dayStartMs, locale),
        recency: relativeTime(lead.lastActivityAt ?? lead.createdAt, nowMs, locale),
      }))
      // De-duplicate defensively: a lead created between batches could otherwise
      // appear twice and collide on its React key.
      setItems((prev) => {
        const seen = new Set(prev.map((r) => r.id))
        return [...prev, ...cards.filter((c) => !seen.has(c.id))]
      })
      setBatch(next.page)
      setMore(next.hasMore)
    } catch {
      toast('error', translatorFor(locale)('leads.mobile.list.loadMoreFailed'))
    } finally {
      loadingRef.current = false
      setLoadingMore(false)
    }
  }, [batch, dayStartMs, filters, more, nowMs, locale])

  useEffect(() => {
    if (pendingRef.current > 0) return
    setItems(initialCards)
    /**
     * Reset the batch cursor WITH the list. A new search re-renders batch 1 from
     * the server; leaving `batch` at 3 would make the next "טען עוד" ask for
     * batch 4 of the NEW result set and silently skip its batches 2-3, and a
     * stale `more` would keep offering the button on an exhausted list.
     * Invalidating `requestKeyRef` also drops any batch still in flight.
     */
    setBatch(page)
    setMore(hasMore)
    requestKeyRef.current = `${filters.q}|${filters.status.join(',')}`
  }, [initialCards, page, hasMore, filters.q, filters.status, pendingRef])

  return { items, setItems, itemsRef, more, loadingMore, loadMore }
}
