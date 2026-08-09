'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { formatCurrency } from '@/lib/funcs'
import { setQuoteTemplateStateAction } from '@/actions/quotes/templates'
import type { QuoteTemplateOverview } from '@/db/quotes/templateWrites'
import QuoteTemplateSheet, { BLANK_TEMPLATE, type TemplateSheetDraft } from './QuoteTemplateSheet'
import { quoteTemplateErrorMessage, TEMPLATE_STATE_LABEL, updatedLabel, validityLabel } from './templateCopy'

/**
 * תבניות הצעות מחיר — the agency's price list.
 *
 * A thin orchestrator over the existing settings patterns: a list, one primary
 * action, and a `ModalPop` editor. It owns which sheet is open and nothing else.
 * No new layout, no new component family.
 *
 * ARCHIVING, NEVER DELETING. A quote records where it came from, so removing a
 * template would erase the provenance of quotes already sent. Archiving also
 * removes it from the selection primitive, which is exactly what "stop offering
 * this price" means — and it is reversible from this same list, which is why
 * archived rows stay visible here.
 */

export default function QuoteTemplatesSettings({
  templates,
  drafts,
}: {
  templates: QuoteTemplateOverview[]
  /** Full editable documents, keyed by id — loaded server-side with the list. */
  drafts: Record<number, TemplateSheetDraft>
}) {
  const router = useRouter()
  const [sheet, setSheet] = useState<TemplateSheetDraft | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<QuoteTemplateOverview | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  // One clock for every row, so no two disagree about "לפני שעתיים".
  const now = useMemo(() => Date.now(), [])
  const active = templates.filter((t) => t.state === 'active')
  const archived = templates.filter((t) => t.state === 'archived')

  function setState(t: QuoteTemplateOverview, state: 'active' | 'archived') {
    setBusyId(t.id)
    startTransition(async () => {
      const res = await setQuoteTemplateStateAction(t.id, state)
      setBusyId(null)
      setConfirmArchive(null)
      if ('reason' in res) return toast('error', quoteTemplateErrorMessage(res.reason))
      toast('success', state === 'archived' ? 'התבנית הועברה לארכיון' : 'התבנית הוחזרה לשימוש')
      router.refresh()
    })
  }

  return (
    <div className='grid gap-6 max-w-3xl'>
      <header className='flex items-end justify-between gap-4'>
        <div>
          <h1 className='text-xl font-semibold text-gray-800'>תבניות הצעות מחיר</h1>
          <p className='text-sm text-gray-500 mt-1'>
            המחירים שמהם נבנות ההצעות. הצעה שנשלחה שומרת את המחיר שלה — עדכון תבנית לא משנה הצעות קיימות.
          </p>
        </div>
        <Btn icon='file-plus' lbl='הצעת מחיר חדשה' onClick={() => setSheet({ ...BLANK_TEMPLATE })} />
      </header>

      {templates.length === 0 ? (
        <EmptyState onCreate={() => setSheet({ ...BLANK_TEMPLATE })} />
      ) : (
        <>
          <TemplateList
            rows={active}
            now={now}
            busyId={busyId}
            drafts={drafts}
            onEdit={setSheet}
            onArchive={setConfirmArchive}
          />
          {archived.length > 0 && (
            <section className='grid gap-3'>
              <h2 className='text-sm font-semibold text-gray-600'>ארכיון</h2>
              <TemplateList
                rows={archived}
                now={now}
                busyId={busyId}
                drafts={drafts}
                onEdit={setSheet}
                onRestore={(t) => setState(t, 'active')}
              />
            </section>
          )}
        </>
      )}

      {sheet && (
        <QuoteTemplateSheet
          draft={sheet}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null)
            router.refresh()
          }}
        />
      )}

      <ConfirmPop
        open={confirmArchive !== null}
        onClose={() => setConfirmArchive(null)}
        onConfirm={() => confirmArchive && setState(confirmArchive, 'archived')}
        msg={
          confirmArchive
            ? `להעביר את "${confirmArchive.name}" לארכיון?\nהצעות קיימות לא ישתנו, אבל לא יהיה אפשר לבחור בתבנית להצעות חדשות.`
            : ''
        }
        confirmLbl='העבר לארכיון'
      />
    </div>
  )
}

function TemplateList({
  rows,
  now,
  busyId,
  drafts,
  onEdit,
  onArchive,
  onRestore,
}: {
  rows: QuoteTemplateOverview[]
  now: number
  busyId: number | null
  drafts: Record<number, TemplateSheetDraft>
  onEdit: (draft: TemplateSheetDraft) => void
  onArchive?: (t: QuoteTemplateOverview) => void
  onRestore?: (t: QuoteTemplateOverview) => void
}) {
  if (rows.length === 0) return <p className='text-sm text-gray-500'>אין תבניות פעילות.</p>

  return (
    <ul className='border rounded-md bg-white divide-y'>
      {rows.map((t) => {
        const touched = updatedLabel(t.updatedAt, now)
        return (
          <li key={t.id} className='px-4 py-3 flex items-start justify-between gap-4'>
            <div className='min-w-0'>
              <p className='font-semibold text-gray-800 truncate'>{t.name}</p>
              <p className='text-sm text-gray-500 mt-0.5'>
                {t.itemCount === 1 ? 'שורה אחת' : `${t.itemCount} שורות`}
                {t.optionalItemCount > 0 && ` · ${t.optionalItemCount} אופציונליות`}
                {' · '}
                {formatCurrency(t.subtotalAmount)} לפני מע״מ
                {' · '}
                תוקף {validityLabel(t.validityDays)}
              </p>
              <p className='text-sm text-gray-400 mt-0.5'>
                {TEMPLATE_STATE_LABEL[t.state]}
                {touched && ` · ${touched}`}
              </p>
            </div>
            <div className='flex gap-2 shrink-0'>
              <Btn
                variant='outline'
                size='small'
                lbl='עריכה'
                disabled={busyId === t.id || !drafts[t.id]}
                onClick={() => drafts[t.id] && onEdit(drafts[t.id])}
              />
              {onArchive && (
                <Btn
                  variant='ghost'
                  size='small'
                  lbl='לארכיון'
                  disabled={busyId === t.id}
                  onClick={() => onArchive(t)}
                />
              )}
              {onRestore && (
                <Btn
                  variant='ghost'
                  size='small'
                  lbl='החזרה לשימוש'
                  disabled={busyId === t.id}
                  onClick={() => onRestore(t)}
                />
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** What / why / what next — the ux-guidelines §4 empty state. */
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className='border border-dashed rounded-md bg-white text-center py-12 px-6'>
      <p className='text-base text-gray-700 mb-1'>אין עדיין תבניות הצעות מחיר</p>
      <p className='text-sm text-gray-500 mb-4'>
        תבנית מרכזת את המחירים שאתם מציעים, כך שאפשר לשלוח הצעה בלי להקליד אותה מחדש בכל פעם.
      </p>
      <Btn icon='file-plus' lbl='הצעת מחיר חדשה' onClick={onCreate} />
    </div>
  )
}
