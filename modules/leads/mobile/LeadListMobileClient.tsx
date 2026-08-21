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
  setAction,
  toggleSelection,
  type SelectionState,
} from '@/components/mobile/selectionState'
import { deleteManyLeads } from '@/actions/clients'
import { deleteLeadsMessage } from '@/lib/leads/deleteResult'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { openLeadWhatsappInInbox, WHATSAPP_CONNECT_HREF } from '@/modules/inbox/client/openLeadWhatsapp'
import { leadsHref, type LeadFilters } from '@/modules/leads/filters'
import LeadFilterBar from './LeadFilterBar'
import LeadCardMobile from './LeadCardMobile'
import LeadStatusSheet from './LeadStatusSheet'
import LeadFollowUpSheet from './LeadFollowUpSheet'
import LeadListActionsSheet from './LeadListActionsSheet'
import LeadListAddControl from './LeadListAddControl'
import { LeadSelectionActions, LeadSelectionHeader } from './LeadSelectionBar'
import { followUpBadge } from './followUpBadge'
import { patchLead, removeSelectedLeads, restoreLeads, type LeadListCard } from './leadSelection'

export default function LeadListMobileClient({
  cards: initialCards,
  filters,
  hasMore,
  page,
  nowMs,
  dayStartMs,
}: {
  cards: LeadListCard[]
  filters: LeadFilters
  hasMore: boolean
  page: number
  nowMs: number
  dayStartMs: number
}) {
  const router = useRouter()
  const [items, setItems] = useState(initialCards)
  const [sel, setSel] = useState<SelectionState>(emptySelection)
  const [busy, setBusy] = useState(false)
  const pendingRef = useRef(0)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const selecting = isSelecting(sel)
  const selected = sel.ids
  const filterKey = `${filters.q}|${filters.status.join(',')}|${page}`

  useEffect(() => {
    if (pendingRef.current > 0) return
    setItems(initialCards)
  }, [initialCards])

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
    void openLeadWhatsappInInbox(leadId, (href) => router.push(href), {
      // No WhatsApp connected: route to the connect UI, never out of the app.
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
    <div className='flex min-h-full flex-col'>
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
                  />
                </li>
              ))}
            </ul>
          </div>

          {!selecting && (
            <div className='flex items-center justify-between gap-3 px-4 py-4'>
              {page > 1 ? (
                <PageLink filters={filters} page={page - 1} label='הקודם' />
              ) : (
                <span aria-hidden className='min-h-11' />
              )}
              <span className='text-[12px] tabular-nums text-gray-400'>{`עמוד ${page}`}</span>
              {hasMore ? <PageLink filters={filters} page={page + 1} label='הבא' /> : <span aria-hidden className='min-h-11' />}
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

function PageLink({ filters, page, label }: { filters: LeadFilters; page: number; label: string }) {
  const href = `${leadsHref(filters)}${leadsHref(filters).includes('?') ? '&' : '?'}page=${page}`
  return (
    <Link
      href={href as Route}
      className='flex min-h-11 items-center rounded-md border border-gray-200 bg-white px-4 text-[14px] font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    >
      {label}
    </Link>
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
