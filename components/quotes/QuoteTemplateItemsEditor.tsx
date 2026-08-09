'use client'

import { Btn } from '@/lib/btns/Btn'
import { Checkbox, Input } from '@/lib/form'
import { formatCurrency } from '@/lib/funcs'
import { computeQuoteTotals } from '@/lib/quotes/totals'
import { MAX_ITEMS, MAX_ITEM_TITLE_LENGTH, type QuoteTemplateItemDraft } from '@/lib/quotes/templateValidation'

/**
 * The lines a template holds — the price list itself.
 *
 * LOCAL STATE, ONE SAVE. Every edit here is client state until the sheet's save
 * button runs one Server Action that replaces the whole item set in a
 * transaction. That is the `AutomationSheet` shape rather than the invoice
 * editor's commit-on-blur-per-line shape, and the difference is deliberate: an
 * invoice line is a legal record that must persist the moment it is typed, while
 * a template is a document you are drafting. One save also means a template can
 * never be left half-edited by a failed request.
 *
 * Totals come from `computeQuoteTotals` — the same function the quote itself
 * will use, so what an admin sees here and what a customer receives cannot
 * disagree. Nothing is recomputed by hand.
 *
 * NO VAT IS SHOWN AS PART OF THE TEMPLATE. The template stores no tax policy;
 * VAT is resolved from the agency's live settings when a quote is created. The
 * figure below is the pre-VAT value, and it says so.
 */

const numOrZero = (raw: string): number => {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

export default function QuoteTemplateItemsEditor({
  items,
  onChange,
}: {
  items: QuoteTemplateItemDraft[]
  onChange: (next: QuoteTemplateItemDraft[]) => void
}) {
  const totals = computeQuoteTotals(
    items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
      taxRatePercentSnapshot: 0,
      isOptional: i.isOptional,
    })),
  )

  const patch = (index: number, changes: Partial<QuoteTemplateItemDraft>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...changes } : item)))

  const remove = (index: number) => onChange(items.filter((_, i) => i !== index))

  /** Reordering is an array move; line numbers are assigned at save time. */
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const add = () =>
    onChange([...items, { title: '', description: '', quantity: 1, unitPrice: 0, discount: 0, isOptional: false }])

  return (
    <section className='grid gap-3'>
      <h3 className='text-sm font-semibold text-gray-800'>שורות ההצעה</h3>

      {items.length === 0 && (
        <p className='text-sm text-gray-500 ms-1'>עדיין אין שורות. הוסיפו לפחות שורה אחת כדי שאפשר יהיה להשתמש בתבנית.</p>
      )}

      <ol className='grid gap-3'>
        {items.map((item, index) => (
          <li key={index} className='grid gap-3 rounded-md border border-gray-200 p-3'>
            <div className='flex items-start justify-between gap-2'>
              <span className='text-sm text-gray-500 pt-2'>{index + 1}</span>
              <div className='flex gap-1'>
                <Btn
                  variant='ghost'
                  size='icon'
                  icon='arrow-up'
                  lbl=''
                  aria-label={`הזז שורה ${index + 1} למעלה`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                />
                <Btn
                  variant='ghost'
                  size='icon'
                  icon='arrow-down'
                  lbl=''
                  aria-label={`הזז שורה ${index + 1} למטה`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                />
                <Btn
                  variant='ghost'
                  size='icon'
                  icon='trash'
                  lbl=''
                  aria-label={`מחק שורה ${index + 1}`}
                  onClick={() => remove(index)}
                />
              </div>
            </div>

            <Input
              lbl='תיאור השורה'
              value={item.title}
              maxLength={MAX_ITEM_TITLE_LENGTH}
              onChange={(e) => patch(index, { title: e.target.value })}
            />
            <Input
              as='textarea'
              lbl='פירוט (אופציונלי)'
              required={false}
              rows={2}
              value={item.description}
              onChange={(e) => patch(index, { description: e.target.value })}
            />

            <div className='grid grid-cols-3 gap-2'>
              <Input
                lbl='כמות'
                type='number'
                min={0}
                step='any'
                value={String(item.quantity)}
                onChange={(e) => patch(index, { quantity: numOrZero(e.target.value) })}
              />
              <Input
                lbl='מחיר ליחידה'
                type='number'
                min={0}
                step='any'
                value={String(item.unitPrice)}
                onChange={(e) => patch(index, { unitPrice: numOrZero(e.target.value) })}
              />
              <Input
                lbl='הנחה'
                type='number'
                min={0}
                step='any'
                required={false}
                value={String(item.discount)}
                onChange={(e) => patch(index, { discount: numOrZero(e.target.value) })}
              />
            </div>

            <div className='flex items-center justify-between gap-3'>
              <Checkbox
                lbl='שורה אופציונלית — הלקוח יכול לוותר עליה'
                checked={item.isOptional}
                onChange={(e) => patch(index, { isOptional: e.target.checked })}
              />
              <span className='text-sm text-gray-600 tabular-nums'>
                {formatCurrency(totals.lines[index]?.lineSubtotal ?? 0)}
              </span>
            </div>
          </li>
        ))}
      </ol>

      <div>
        <Btn
          variant='outline'
          size='small'
          icon='plus'
          lbl='הוספת שורה'
          disabled={items.length >= MAX_ITEMS}
          onClick={add}
        />
      </div>

      <div className='border-t border-gray-100 pt-3 flex items-baseline justify-between gap-3'>
        <span className='text-sm font-semibold text-gray-800'>סה״כ לפני מע״מ</span>
        <span className='text-base font-semibold tabular-nums'>{formatCurrency(totals.subtotalAmount)}</span>
      </div>
      <p className='text-sm text-gray-500 ms-1'>
        מע״מ נקבע בעת יצירת ההצעה לפי הגדרות העסק, ולא נשמר בתבנית. שורות אופציונליות אינן נכללות בסכום.
      </p>
    </section>
  )
}
