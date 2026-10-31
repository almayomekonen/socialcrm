'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  emptySelection,
  enterSelection,
  isSelecting,
  reconcileAction,
  setAction,
  toggleSelection,
  type ActionContext,
  type SelectionState,
} from '@/components/mobile/selectionState'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { WHATSAPP_CONNECT_HREF } from '@/modules/inbox/client/openLeadWhatsapp'
import { type LeadFilters } from '@/modules/leads/filters'
import LeadFilterBar from './LeadFilterBar'
import LeadCardMobile from './LeadCardMobile'
import { contactLeadViaWhatsapp } from '@/modules/leads/contactLead'
import LeadListAddControl from './LeadListAddControl'
import LeadListFilteredEmpty from './LeadListFilteredEmpty'
import LeadListLoadMore from './LeadListLoadMore'
import LeadListSheets from './LeadListSheets'
import { LeadSelectionActions, LeadSelectionHeader } from './LeadSelectionBar'
import type { LeadListCard } from './leadSelection'
import { useLeadListBatches } from './useLeadListBatches'
import { useLeadListDelete } from './useLeadListDelete'

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
  const t = useT()
  const region = useRegionAttrs()
  const pendingRef = useRef(0)
  const { items, setItems, itemsRef, more, loadingMore, loadMore } = useLeadListBatches({
    initialCards,
    filters,
    hasMore,
    page,
    nowMs,
    dayStartMs,
    pendingRef,
    locale: t.locale,
  })
  const [sel, setSel] = useState<SelectionState>(emptySelection)

  const selecting = isSelecting(sel)
  const selected = sel.ids
  const filterKey = `${filters.q}|${filters.status.join(',')}|${page}`

  useEffect(() => {
    if (pendingRef.current > 0) return
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

  const { busy, runDelete } = useLeadListDelete({ selected, itemsRef, setItems, setSel, exit, pendingRef })

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
      locale: t.locale,
    })
  }

  const count = selected.size

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
    <div className='flex min-h-full shrink-0 flex-col' {...region}>
      {selecting ? (
        <LeadSelectionHeader count={count} busy={busy} onCancel={exit} />
      ) : (
        <LeadFilterBar filters={filters} resultCount={items.length} />
      )}

      {items.length === 0 ? (
        <LeadListFilteredEmpty filters={filters} />
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

          {!selecting && more && <LeadListLoadMore loading={loadingMore} onLoad={loadMore} />}
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

      <LeadListSheets
        action={sel.action}
        actionLeadId={actionLeadId}
        actionLead={actionLead}
        count={count}
        nowMs={nowMs}
        dayStartMs={dayStartMs}
        setAction={(next: ActionContext) => setSel((prev) => setAction(prev, next))}
        setItems={setItems}
        onOpenConversation={openConversation}
        onDelete={runDelete}
      />

      <LeadListAddControl selecting={selecting} />
    </div>
  )
}

