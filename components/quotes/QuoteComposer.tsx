'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import { formatCurrency } from '@/lib/funcs'
import { computeQuoteTotals } from '@/lib/quotes/totals'
import { MAX_ITEMS, MAX_VALIDITY_DAYS, MIN_VALIDITY_DAYS, validateQuoteTemplateDraft, type QuoteTemplateItemDraft } from '@/lib/quotes/templateValidation'
import { getQuoteComposerDataAction, saveQuoteTemplateAction, type QuoteComposerData } from '@/actions/quotes/templates'
import type { InlineCreatorProps } from '@/components/settings/templates/firstPartyCreators'
import QuoteComposerRow from './QuoteComposerRow'

/**
 * Build the quotation INSIDE the automation install flow.
 *
 * The point of this component is that a first automation needs no trip to
 * settings: the price list the automation will use is authored here, saved
 * through the ordinary quote-template domain, and its id handed back to the
 * shared installer as the value of a perfectly ordinary template variable.
 *
 * NOTHING IS FORKED. Totals come from `computeQuoteTotals`, validation from
 * `validateQuoteTemplateDraft`, persistence from `saveQuoteTemplateAction` —
 * the same three the settings editor uses. What differs is only presentation:
 * a document rather than a form, because the customer is looking at what their
 * lead will eventually receive.
 *
 * VAT IS NOT STORED ON THE TEMPLATE. The rate below is the agency's live
 * effective policy, shown so the total is truthful, and applied for real when a
 * quote is created. An exempt business sees 0% here and gets 0% there.
 *
 * The install button does not wait for a save: the composer registers a
 * RESOLVER, and the shared dialog runs it as the first step of installing. That
 * keeps "create the template, then install with its id" a sequence the shell
 * expresses generically rather than a quotation special case.
 */

const NEW = '__new__'

/** `formatCurrency` widens to `string | number` for NaN; the document wants text. */
const money = (n: number): string => String(formatCurrency(n))

const blankItem = (): QuoteTemplateItemDraft => ({
  title: '',
  description: '',
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  isOptional: false,
})

export default function QuoteComposer({ variable, value, onChange, onResolverChange }: InlineCreatorProps) {
  const [data, setData] = useState<QuoteComposerData | null>(null)
  const [choice, setChoice] = useState<string>(value || NEW)
  const [name, setName] = useState('')
  const [validityDays, setValidityDays] = useState('14')
  const [items, setItems] = useState<QuoteTemplateItemDraft[]>([blankItem()])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await getQuoteComposerDataAction()
      if (cancelled) return
      if (res.ok) {
        setData(res.data)
        // No price list yet ⇒ open straight into building one. A disabled
        // dropdown with nothing in it explains nothing.
        setChoice((c) => (c === NEW && res.data.templates.length > 0 ? String(res.data.templates[0].id) : c))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const creating = choice === NEW
  const draft = { name, title: name, introText: '', termsText: '', validityDays: Number(validityDays) || 0, items }
  const totals = computeQuoteTotals(
    items.map((i) => ({ ...i, taxRatePercentSnapshot: creating ? (data?.taxRatePercent ?? 0) : 0 })),
  )

  /**
   * What the installer runs before it installs. Picking an existing list is
   * already an id; building a new one saves first and yields the id the domain
   * assigns. Either way the shell receives one string and never learns which
   * happened.
   */
  useEffect(() => {
    onResolverChange(async () => {
      if (!creating) {
        return choice ? { ok: true as const, value: choice } : { ok: false as const, reason: 'template_required' }
      }
      const issue = validateQuoteTemplateDraft(draft)
      if (issue) return { ok: false as const, reason: issue }
      const res = await saveQuoteTemplateAction({ draft })
      if ('reason' in res) return { ok: false as const, reason: res.reason }
      const id = String(res.templateId)
      onChange(id)
      return { ok: true as const, value: id }
    })
    return () => onResolverChange(null)
  }, [choice, creating, name, validityDays, JSON.stringify(items)])

  const patch = (index: number, changes: Partial<QuoteTemplateItemDraft>) =>
    setItems(items.map((it, i) => (i === index ? { ...it, ...changes } : it)))

  if (!data) return <p className='text-sm text-gray-500 ms-1'>טוען…</p>

  return (
    <section className='grid gap-3'>
      {data.templates.length > 0 && (
        <Select
          lbl={variable.label}
          options={[
            ...data.templates.map((t) => ({ id: String(t.id), name: t.name })),
            { id: NEW, name: 'בניית הצעה חדשה' },
          ]}
          value={choice}
          onChange={(e) => {
            setChoice(e.target.value)
            onChange(e.target.value === NEW ? '' : e.target.value)
          }}
        />
      )}

      {creating && (
        <>
          <Input
            lbl='שם ההצעה'
            info='לשימוש פנימי'
            value={name}
            maxLength={120}
            placeholder='לדוגמה: בניית אתר'
            onChange={(e) => setName(e.target.value)}
          />

          {/* The document. What the lead will eventually be looking at. */}
          <div className='rounded-lg border border-gray-200 bg-white overflow-hidden'>
            <header className='flex items-baseline justify-between gap-3 bg-gray-50/70 px-4 py-3 border-b border-gray-100'>
              <span className='text-[15px] font-semibold text-gray-800'>הצעת מחיר</span>
              <span className='text-sm text-gray-500 truncate'>{data.businessName}</span>
            </header>

            <div className='px-4 pt-3 pb-4'>
              <p className='text-sm text-gray-500 mb-3'>
                לכבוד: <span className='text-gray-700'>{'{{שם הליד}}'}</span>
                <span className='text-gray-400'> · שם הליד יושלם אוטומטית</span>
              </p>

              <div className='grid grid-cols-[1fr_58px_84px_auto] gap-2 pb-1 border-b border-gray-100 text-[12.5px] text-gray-500'>
                <span>תיאור</span>
                <span className='text-center'>כמות</span>
                <span>מחיר ליחידה</span>
                <span className='w-[86px] text-end'>סה״כ</span>
              </div>

              {items.map((item, i) => (
                <QuoteComposerRow
                  key={i}
                  index={i}
                  item={item}
                  lineTotal={totals.lines[i]?.lineSubtotal ?? 0}
                  onPatch={(c) => patch(i, c)}
                  onRemove={() => setItems(items.filter((_, k) => k !== i))}
                  canRemove={items.length > 1}
                />
              ))}

              <div className='pt-1'>
                <Btn
                  variant='ghost'
                  size='small'
                  icon='plus'
                  lbl='הוספת שורה'
                  disabled={items.length >= MAX_ITEMS}
                  onClick={() => setItems([...items, blankItem()])}
                />
              </div>

              <dl className='mt-3 border-t border-gray-100 pt-3 grid gap-1.5 text-sm'>
                <Row label='סכום ביניים' value={money(totals.subtotalAmount)} />
                {totals.discountAmount > 0 && (
                  <Row label='הנחה' value={`־${money(totals.discountAmount)}`} />
                )}
                <Row label={`מע״מ ${data.taxRatePercent}%`} value={money(totals.taxAmount)} />
                <div className='flex items-baseline justify-between gap-3 border-t border-gray-100 pt-2 mt-0.5'>
                  <dt className='text-[15px] font-semibold text-gray-800'>סה״כ לתשלום</dt>
                  <dd className='text-[17px] font-semibold text-gray-900 tabular-nums'>
                    {money(totals.totalAmount)}
                  </dd>
                </div>
              </dl>

              <div className='mt-3 flex items-center gap-2 border-t border-gray-100 pt-3'>
                <span className='text-sm text-gray-500'>תוקף ההצעה</span>
                <input
                  className='h-9 w-16 rounded-md border border-gray-200 bg-gray-50 px-2 text-center tabular-nums focus:bg-white focus:border-gray-400 focus:outline-2 focus:outline-primary'
                  type='number'
                  min={MIN_VALIDITY_DAYS}
                  max={MAX_VALIDITY_DAYS}
                  value={validityDays}
                  aria-label='תוקף ההצעה בימים'
                  onChange={(e) => setValidityDays(e.target.value)}
                />
                <span className='text-sm text-gray-500'>ימים</span>
              </div>
            </div>
          </div>

          <p className='text-sm text-gray-500 ms-1'>
            המחירים נשמרים על כל הצעה שנוצרת — שינוי ההצעה בהמשך לא ישנה הצעות שכבר נשלחו.
          </p>
        </>
      )}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-baseline justify-between gap-3'>
      <dt className='text-gray-500'>{label}</dt>
      <dd className='text-gray-700 tabular-nums'>{value}</dd>
    </div>
  )
}
