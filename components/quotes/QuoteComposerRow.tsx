'use client'

import { Btn } from '@/lib/btns/Btn'
import { formatCurrency } from '@/lib/funcs'
import { cellInputCls } from '@/components/billing/lines/types'
import type { QuoteTemplateItemDraft } from '@/lib/quotes/templateValidation'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * One line of the quotation, as a DOCUMENT ROW rather than a form.
 *
 * The cell styling is `cellInputCls` — the exact surface the invoice line
 * editor already uses, so an editable price reads the same way here as it does
 * on a real invoice draft. Nothing new is invented; the row simply lays those
 * cells out in document column order.
 *
 * The computed total is display-only and arrives from the parent, which got it
 * from `computeQuoteTotals`. No arithmetic happens in this file.
 */
export default function QuoteComposerRow({
  index,
  item,
  lineTotal,
  onPatch,
  onRemove,
  canRemove,
}: {
  index: number
  item: QuoteTemplateItemDraft
  lineTotal: number
  onPatch: (changes: Partial<QuoteTemplateItemDraft>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const t = useT()
  const n = String(index + 1)
  const num = (raw: string) => {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }

  return (
    <div className='grid grid-cols-[1fr_58px_84px_auto] items-center gap-2 py-1.5'>
      <input
        className={cellInputCls}
        value={item.title}
        maxLength={120}
        placeholder={t('admin.quotes.items.lineTitle')}
        aria-label={t('admin.automationTemplates.composer.rowTitle', { n })}
        onChange={(e) => onPatch({ title: e.target.value })}
      />
      <input
        className={`${cellInputCls} text-center tabular-nums`}
        type='number'
        min={0}
        step='any'
        value={String(item.quantity)}
        aria-label={t('admin.automationTemplates.composer.rowQuantity', { n })}
        onChange={(e) => onPatch({ quantity: num(e.target.value) })}
      />
      <input
        className={`${cellInputCls} tabular-nums`}
        type='number'
        min={0}
        step='any'
        value={String(item.unitPrice)}
        aria-label={t('admin.automationTemplates.composer.rowPrice', { n })}
        onChange={(e) => onPatch({ unitPrice: num(e.target.value) })}
      />

      <div className='flex items-center gap-1'>
        <span
          className={`w-[86px] text-end text-[15px] tabular-nums ${item.isOptional ? 'text-gray-400' : 'text-gray-800'}`}
        >
          {String(formatCurrency(lineTotal))}
        </span>
        {/*
          Optional is a per-line PROPERTY, so it lives on the line rather than in
          a settings panel: an optional row shows its price and is excluded from
          the total, which is what `computeQuoteTotals` already does with it.
        */}
        <Btn
          variant='ghost'
          size='icon'
          icon={item.isOptional ? 'square-check' : 'square'}
          lbl=''
          aria-label={item.isOptional ? t('admin.automationTemplates.composer.rowOptionalOff', { n }) : t('admin.automationTemplates.composer.rowOptionalOn', { n })}
          title={t('admin.quotes.items.optional')}
          onClick={() => onPatch({ isOptional: !item.isOptional })}
        />
        <Btn
          variant='ghost'
          size='icon'
          icon='trash'
          lbl=''
          aria-label={t('admin.quotes.items.remove', { n })}
          disabled={!canRemove}
          onClick={onRemove}
        />
      </div>
    </div>
  )
}
