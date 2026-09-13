'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import ConfirmSheet from '@/components/mobile/ConfirmSheet'
import { toast } from '@/lib/toast'
import {
  emptySelection,
  enterSelection,
  isSelecting,
  reconcileAction,
  setAction,
  toggleSelection,
  type SelectionState,
} from '@/components/mobile/selectionState'
import { deleteManyLeads } from '@/actions/clients'
import { deleteLeadsMessage } from '@/lib/leads/deleteResult'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { WHATSAPP_CONNECT_HREF } from '@/modules/inbox/client/openLeadWhatsapp'
import { type LeadFilters } from '@/modules/leads/filters'
import LeadFilterBar from './LeadFilterBar'
import LeadCardMobile from './LeadCardMobile'
import { contactLeadViaWhatsapp } from '@/modules/leads/contactLead'
import LeadStatusSheet from './LeadStatusSheet'
import LeadFollowUpSheet from './LeadFollowUpSheet'
import LeadListActionsSheet from './LeadListActionsSheet'
import LeadListAddControl from './LeadListAddControl'
import { LeadSelectionActions, LeadSelectionHeader } from './LeadSelectionBar'
import { followUpBadge } from './followUpBadge'
import { relativeTimeHe } from '@/modules/inbox/mobile/relativeTime'
import { loadMoreMobileLeads } from '@/actions/leads/loadMoreMobileLeads'
import { patchLead, removeSelectedLeads, restoreLeads, type LeadListCard } from './leadSelection'

export default function LeadListMobileClient({
  cards: initialCards,
  filters,
  hasMore,
  page,
  nowMs,
  dayStartMs,
  whatsappConnected,
}: {
  cards: LeadListCard[]
  filters: LeadFilters
  hasMore: boolean
  page: number
  nowMs: number
  dayStartMs: number
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
}) {
  const router = useRouter()
  const [items, setItems] = useState(initialCards)
  /**
   * BATCH LOADING, NOT PAGE SWITCHING. `/leads` on a phone used `?page=`, which
   * REPLACED the visible list: reaching lead 31 meant losing leads 1-30 and the
   * scroll position. Batches accumulate here instead — the server still renders
   * batch 1, and every later batch is appended.
   */
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
  const [sel, setSel] = useState<SelectionState>(emptySelection)
  const [busy, setBusy] = useState(false)
  const pendingRef = useRef(0)
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
        followUp: followUpBadge(lead.nextFollowUpAt, nowMs, dayStartMs),
        recency: relativeTimeHe(lead.lastActivityAt ?? lead.createdAt, nowMs),
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
      toast('error', 'לא הצלחנו לטעון עוד לידים')
    } finally {
      loadingRef.current = false
      setLoadingMore(false)
    }
  }, [batch, dayStartMs, filters, more, nowMs])

  const selecting = isSelecting(sel)
  const selected = sel.ids
  const filterKey = `${filters.q}|${filters.status.join(',')}|${page}`

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

    /**
     * RECONCILE SELECTION AGAINST THE LIST.
     *
     * `reconcileAction` keeps the open sheet honest against `ids`, but nothing
     * kept `ids` honest against the ROWS. Changing a lead's status revalidates
     * `/leads`; the lead can then leave this list — filtered out by an active
     * status filter, or reordered past the loaded batch — while its id stayed
     * selected. The bar went on reading "נבחרו 1" for a row that no longer
     * existed, and every per-item control resolved `items.find(...)` to null, so
     * `פעולות` opened nothing and looked broken.
     *
     * Only orphaned ids are dropped, never the whole selection: a lead that is
     * still visible stays selected, and in a multi-select the survivors keep
     * theirs. Returning `prev` unchanged when nothing was orphaned keeps the
     * object identity stable, so the common case causes no extra render.
     *
     * The delete path already reconciles this way (it restores `ids` for blocked
     * leads); this closes the same gap for status and follow-up, and for any
     * future mutation, because it hooks the list REPLACEMENT rather than each
     * individual `onSaved`.
     */
    setSel((prev) => {
      if (prev.ids.size === 0) return prev
      const live = new Set(initialCards.map((card) => card.id))
      const kept = new Set([...prev.ids].filter((id) => live.has(id)))
      if (kept.size === prev.ids.size) return prev
      return { ids: kept, action: reconcileAction(kept, prev.action) }
    })
  }, [initialCards, page, hasMore, filters.q, filters.status])

  useEffect(() => {
    setSel(emptySelection())
  }, [filterKey])

  const exit = useCallback(() => setSel(emptySelection()), [])
  const enter = useCallback((id: number) => setSel(enterSelection(id)), [])
  const toggle = useCallback((id: number) => setSel((prev) => toggleSelection(prev, id)), [])

  const actionLeadId =
    sel.action && sel.action.type !== 'confirm-delete' ? sel.action.id : selected.size === 1 ? [...selected][0] : null
  const actionLead = useMemo(
    () => (actionLeadId != null ? items.find((row) => row.id === actionLeadId) ?? null : null),
    [actionLeadId, items],
  )

  const runDelete = async () => {
    const ids = new Set(selected)
    if (ids.size === 0) return
    const snapshot = itemsRef.current
    pendingRef.current += 1
    setBusy(true)
    setSel((prev) => setAction(prev, null))
    setItems(removeSelectedLeads(snapshot, ids))
    try {
      const result = await deleteManyLeads([...ids])
      const blocked = new Set(result.blockedLeads.map((b) => b.id))
      if (result.deletedCount === 0 && result.blockedCount === 0) {
        setItems((current) => restoreLeads(current, snapshot, ids))
        setSel({ ids, action: null })
        toast('error', 'לא נמחקו לידים')
      } else {
        const { icon, msg } = deleteLeadsMessage(result)
        toast(icon, msg)
        if (blocked.size > 0) {
          setItems((current) => restoreLeads(current, snapshot, blocked))
          setSel({ ids: blocked, action: null })
        } else {
          exit()
        }
      }
    } catch {
      setItems((current) => restoreLeads(current, snapshot, ids))
      setSel({ ids, action: null })
      toast('error', 'לא הצלחנו למחוק את הלידים')
    }
    pendingRef.current -= 1
    setBusy(false)
  }

  const openConversation = () => {
    if (!actionLead) return
    const leadId = actionLead.id
    setSel((prev) => setAction(prev, null))
    recordLeadActionEvent('lead_action_taken', {
      surface: 'mobile',
      action: 'message',
      leadId,
      via: 'inbox',
    }).catch(() => {})

    contactLeadViaWhatsapp(actionLead, whatsappConnected, (href) => router.push(href), 'mobile', {
      // Unchanged for callers that do not know the connection state.
      onNoConnection: () => router.push(WHATSAPP_CONNECT_HREF),
    })
  }

  const count = selected.size
  const deleteMsg =
    count === 1
      ? `האם למחוק את "${actionLead?.name ?? 'הליד'}"?\nלא ניתן לשחזר את הליד לאחר המחיקה.`
      : `האם למחוק ${count} לידים?\nלא ניתן לשחזר את הלידים לאחר המחיקה.`

  const itemActionsOpen = sel.action?.type === 'item-actions'
  const confirmOpen = sel.action?.type === 'confirm-delete'
  const statusOpen = sel.action?.type === 'status'
  const followUpOpen = sel.action?.type === 'followup'

  return (
    /*
      `shrink-0` is load-bearing, not cosmetic.

      `#main-content` is the single scroll owner and is `display:flex;
      flex-direction:column`, so this div is a flex item. Flex items default to
      `min-height:auto`, which is what normally stops them shrinking below their
      content and lets a tall list grow the scroller. `min-h-full` REPLACES that
      with `min-height:100%`, so the item became shrinkable and `flex-shrink:1`
      collapsed it to exactly the viewport height — `scrollHeight` never exceeded
      `clientHeight` and the list simply could not be scrolled, no matter how
      many batches were appended.

      Measured in a real browser at 390x844: 30 cards (~2130px of content) left
      the child clamped at 844px and unscrollable; with `shrink-0` it measures
      2130px and scrolls. `min-h-full` is kept so a short/empty list still fills
      the screen.
    */
    <div className='flex min-h-full shrink-0 flex-col'>
      {selecting ? (
        <LeadSelectionHeader count={count} busy={busy} onCancel={exit} />
      ) : (
        <LeadFilterBar filters={filters} resultCount={items.length} />
      )}

      {items.length === 0 ? (
        <FilteredEmpty filters={filters} />
      ) : (
        <>
          <div className='mx-3 mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white'>
            <ul className='divide-y divide-gray-100'>
              {items.map((lead) => (
                <li key={lead.id}>
                  <LeadCardMobile
                    lead={lead}
                    followUp={lead.followUp}
                    recency={lead.recency}
                    selecting={selecting}
                    selected={selected.has(lead.id)}
                    onToggle={() => toggle(lead.id)}
                    onEnterSelection={() => enter(lead.id)}
                    whatsappConnected={whatsappConnected}
                  />
                </li>
              ))}
            </ul>
          </div>

          {/*
            One control, and it only exists while there IS a next batch — when
            the list is exhausted it disappears rather than becoming a dead
            "עמוד N" with nowhere to go.
          */}
          {!selecting && more && (
            <div className='px-4 py-4'>
              <button
                type='button'
                onClick={loadMore}
                disabled={loadingMore}
                aria-busy={loadingMore}
                className='press flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white text-sm font-medium text-gray-800 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
              >
                {loadingMore ? (
                  <>
                    <Icon name='spinner' type='sol' aria-hidden className='size-4 animate-spin bg-gray-500' />
                    טוען…
                  </>
                ) : (
                  'טען עוד'
                )}
              </button>
            </div>
          )}
        </>
      )}

      {selecting && (
        <LeadSelectionActions
          count={count}
          busy={busy}
          canOpenItemActions={count === 1}
          onCancel={exit}
          onActions={() => {
            const id = [...selected][0]
            if (id == null) return
            setSel((prev) => setAction(prev, { type: 'item-actions', id }))
          }}
          onDelete={() => setSel((prev) => setAction(prev, { type: 'confirm-delete' }))}
        />
      )}

      <LeadListActionsSheet
        open={itemActionsOpen}
        lead={actionLead}
        onClose={() => setSel((prev) => setAction(prev, null))}
        onStatus={() => {
          if (actionLeadId == null) return
          setSel((prev) => setAction(prev, { type: 'status', id: actionLeadId }))
        }}
        onFollowUp={() => {
          if (actionLeadId == null) return
          setSel((prev) => setAction(prev, { type: 'followup', id: actionLeadId }))
        }}
        onOpenConversation={openConversation}
        onDelete={() => setSel((prev) => setAction(prev, { type: 'confirm-delete' }))}
      />

      {actionLeadId != null && (
        <LeadStatusSheet
          open={statusOpen}
          onClose={() => setSel((prev) => setAction(prev, null))}
          leadId={actionLeadId}
          current={actionLead?.status ?? null}
          refresh={false}
          onSaved={(status) => {
            setItems((prev) => patchLead(prev, actionLeadId, { status }))
          }}
        />
      )}

      {actionLeadId != null && (
        <LeadFollowUpSheet
          open={followUpOpen}
          onClose={() => setSel((prev) => setAction(prev, null))}
          leadId={actionLeadId}
          current={actionLead?.nextFollowUpAt ?? null}
          refresh={false}
          onSaved={(nextFollowUpAt) => {
            setItems((prev) =>
              patchLead(prev, actionLeadId, {
                nextFollowUpAt,
                followUp: followUpBadge(nextFollowUpAt, nowMs, dayStartMs),
              }),
            )
          }}
        />
      )}

      <ConfirmSheet
        open={confirmOpen}
        destructive
        title={count === 1 ? 'מחיקת ליד' : 'מחיקת לידים'}
        msg={deleteMsg}
        confirmLbl={count === 1 ? 'מחק ליד' : 'מחק לידים'}
        cancelLbl='ביטול'
        onClose={() => setSel((prev) => setAction(prev, null))}
        onConfirm={runDelete}
      />

      <LeadListAddControl selecting={selecting} />
    </div>
  )
}

function FilteredEmpty({ filters }: { filters: LeadFilters }) {
  return (
    <div className='flex flex-col items-center gap-4 px-6 py-14 text-center'>
      <span className='flex size-12 items-center justify-center rounded-full bg-gray-100'>
        <Icon name='magnifying-glass' type='reg' className='size-5 bg-gray-400' />
      </span>
      <div className='max-w-[300px]'>
        <h2 className='text-base font-bold text-ink'>לא נמצאו לידים</h2>
        <p className='mt-1 text-sm leading-relaxed text-gray-500'>
          {filters.q ? `אין תוצאות עבור "${filters.q}".` : 'אין לידים בסטטוסים שנבחרו.'}
        </p>
      </div>
      <Link
        href={'/leads' as Route}
        className='flex min-h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        נקה סינון
      </Link>
    </div>
  )
}
