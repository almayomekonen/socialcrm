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
import { quoteTemplateErrorMessage, templateStateLabel, updatedLabel, validityLabelIn } from './templateCopy'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import { customerTextAttrs } from '@/lib/i18n/config'

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
  const t = useT()
  const region = useRegionAttrs()
  const [sheet, setSheet] = useState<TemplateSheetDraft | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<QuoteTemplateOverview | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  // One clock for every row, so no two disagree about "לפני שעתיים".
  const now = useMemo(() => Date.now(), [])
  const active = templates.filter((tpl) => tpl.state === 'active')
  const archived = templates.filter((tpl) => tpl.state === 'archived')

  function setState(tpl: QuoteTemplateOverview, state: 'active' | 'archived') {
    setBusyId(tpl.id)
    startTransition(async () => {
      const res = await setQuoteTemplateStateAction(tpl.id, state)
      setBusyId(null)
      setConfirmArchive(null)
      if ('reason' in res) return toast('error', quoteTemplateErrorMessage(res.reason, t.locale))
      toast('success', state === 'archived' ? t('admin.quotes.archived') : t('admin.quotes.restored'))
      router.refresh()
    })
  }

  return (
    <div className='grid gap-6 max-w-3xl' {...region}>
      <header className='flex items-end justify-between gap-4'>
        <div>
          <h1 className='text-xl font-semibold text-gray-800'>{t('admin.quotes.title')}</h1>
          <p className='text-sm text-gray-500 mt-1'>{t('admin.quotes.intro')}</p>
        </div>
        <Btn icon='file-plus' lbl={t('admin.quotes.create')} onClick={() => setSheet({ ...BLANK_TEMPLATE })} />
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
              <h2 className='text-sm font-semibold text-gray-600'>{t('admin.quotes.archiveTitle')}</h2>
              <TemplateList
                rows={archived}
                now={now}
                busyId={busyId}
                drafts={drafts}
                onEdit={setSheet}
                onRestore={(tpl) => setState(tpl, 'active')}
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
            ? t('admin.quotes.archiveConfirm', { name: confirmArchive.name })
            : ''
        }
        confirmLbl={t('admin.quotes.archiveConfirmLbl')}
        translated
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
  const tr = useT()
  const locale = tr.locale
  if (rows.length === 0) return <p className='text-sm text-gray-500'>{tr('admin.quotes.noActive')}</p>

  return (
    <ul className='border rounded-md bg-white divide-y'>
      {rows.map((t) => {
        const touched = updatedLabel(t.updatedAt, now, locale)
        return (
          <li key={t.id} className='px-4 py-3 flex items-start justify-between gap-4'>
            <div className='min-w-0'>
              <p className='font-semibold text-gray-800 truncate' {...customerTextAttrs(locale)}>
                {t.name}
              </p>
              <p className='text-sm text-gray-500 mt-0.5'>
                {locale === 'he' ? (
                  <>
                    {t.itemCount === 1 ? 'שורה אחת' : `${t.itemCount} שורות`}
                    {t.optionalItemCount > 0 && ` · ${t.optionalItemCount} אופציונליות`}
                    {' · '}
                    {formatCurrency(t.subtotalAmount)} לפני מע״מ
                    {' · '}
                    תוקף {validityLabelIn(t.validityDays)}
                  </>
                ) : (
                  // One sentence per fact (amounts keep the ILS formatter; quotes carry no currency of their own).
                  [
                    tr('admin.quotes.lines', { count: t.itemCount }),
                    t.optionalItemCount > 0 ? tr('admin.quotes.optional', { count: String(t.optionalItemCount) }) : '',
                    ' · ',
                    tr('admin.quotes.beforeVat', { amount: formatCurrency(t.subtotalAmount) }),
                    ' · ',
                    tr('admin.quotes.validity', { days: validityLabelIn(t.validityDays, locale) }),
                  ].join('')
                )}
              </p>
              <p className='text-sm text-gray-400 mt-0.5'>
                {templateStateLabel(t.state, locale)}
                {touched && ` · ${touched}`}
              </p>
            </div>
            <div className='flex gap-2 shrink-0'>
              <Btn
                variant='outline'
                size='small'
                lbl={tr('admin.quotes.edit')}
                disabled={busyId === t.id || !drafts[t.id]}
                onClick={() => drafts[t.id] && onEdit(drafts[t.id])}
              />
              {onArchive && (
                <Btn
                  variant='ghost'
                  size='small'
                  lbl={tr('admin.quotes.archive')}
                  disabled={busyId === t.id}
                  onClick={() => onArchive(t)}
                />
              )}
              {onRestore && (
                <Btn
                  variant='ghost'
                  size='small'
                  lbl={tr('admin.quotes.restore')}
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
  const t = useT()
  return (
    <div className='border border-dashed rounded-md bg-white text-center py-12 px-6'>
      <p className='text-base text-gray-700 mb-1'>{t('admin.quotes.empty.title')}</p>
      <p className='text-sm text-gray-500 mb-4'>{t('admin.quotes.empty.body')}</p>
      <Btn icon='file-plus' lbl={t('admin.quotes.create')} onClick={onCreate} />
    </div>
  )
}
