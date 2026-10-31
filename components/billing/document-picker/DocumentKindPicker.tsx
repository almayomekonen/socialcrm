'use client'

import ModalPop from '@/lib/modals/ModalPop'
import { DOCUMENT_KINDS, type DocumentKindEntry } from '@/lib/billing/documentKinds'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey, Translator } from '@/lib/i18n/translate'

/** Picker label of each kind by its registry `id` (Hebrew = the registry's `label`). */
const KIND_KEY: Record<string, MessageKey> = {
  invoice_receipt: 'leadTabs.billing.picker.kind.invoice_receipt',
  deal_invoice: 'leadTabs.billing.picker.kind.deal_invoice',
  payment_request: 'leadTabs.billing.picker.kind.payment_request',
  order: 'leadTabs.billing.picker.kind.order',
  quote: 'leadTabs.billing.picker.kind.quote',
  credit_note: 'leadTabs.billing.picker.kind.credit_note',
}

function kindLabel(t: Translator, entry: DocumentKindEntry): string {
  const key = KIND_KEY[entry.id]
  return key ? t(key) : entry.label
}

/**
 * Pre-create document-kind picker. Six options total; only enabled entries
 * are clickable. Disabled rows render the "בקרוב" tag and are visually muted
 * so the user can see the roadmap without being able to pick a half-built
 * flow. New kinds appear automatically by adding entries to DOCUMENT_KINDS.
 *
 * Follows the interface language (lead billing list only) and, being portalled,
 * declares it. `onPick` receives the registry entry, so routing reads its code.
 */

export default function DocumentKindPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (entry: DocumentKindEntry) => void
}) {
  const t = useT()
  return (
    <ModalPop open={open} pos='middle' onClose={onClose} label={t('leadTabs.billing.picker.label')} className='w-[460px] max-w-[92vw]' translated>
      <div className='grid gap-4'>
        <header>
          <h2 className='text-xl font-bold text-dark'>{t('leadTabs.billing.picker.title')}</h2>
        </header>

        <ul className='grid gap-1'>
          {DOCUMENT_KINDS.map((entry) => (
            <li key={entry.id}>
              <KindRow t={t} entry={entry} onPick={onPick} />
            </li>
          ))}
        </ul>

        <p className='text-sm text-gray-500 border-t border-gray-100 pt-3'>
          {t('leadTabs.billing.picker.help')}
        </p>
      </div>
    </ModalPop>
  )
}

function KindRow({
  t,
  entry,
  onPick,
}: {
  t: Translator
  entry: DocumentKindEntry
  onPick: (entry: DocumentKindEntry) => void
}) {
  if (!entry.enabled) {
    return (
      <div className='flex items-center justify-between gap-3 px-3 py-3 rounded-md text-gray-400 cursor-not-allowed select-none'>
        <span className='text-base'>{kindLabel(t, entry)}</span>
        <span className='text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-500'>{t('leadTabs.billing.picker.soon')}</span>
      </div>
    )
  }

  return (
    <button
      type='button'
      onClick={() => onPick(entry)}
      className={`w-full ${t.locale === 'he' ? 'text-right' : 'text-start'} px-3 py-3 rounded-md text-base text-gray-900 bg-softy/40 hover:bg-softy/70 transition-colors font-medium`}
    >
      {kindLabel(t, entry)}
    </button>
  )
}
