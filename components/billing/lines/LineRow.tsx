'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { formatCurrency } from '@/lib/funcs'
import { useT } from '@/lib/i18n/I18nProvider'
import { cellInputCls, cellSubInputCls, formatField, parseNum, type EditableLine, type LineFormPayload } from './types'

/**
 * Editable row for an EXISTING line. Inline edits commit on blur if
 * the value actually changed and passes per-field validation. Failed
 * commits restore the previous server-side value (parent surfaces
 * its own error toast).
 */
export default function LineRow({
  line,
  onUpdate,
  onAskDelete,
}: {
  line: EditableLine
  onUpdate: (lineId: number, payload: LineFormPayload) => Promise<void> | void
  onAskDelete: () => void
}) {
  const t = useT()
  const [title, setTitle] = useState(line.title)
  const [description, setDescription] = useState(line.description)
  const [quantity, setQuantity] = useState(formatField(line.quantity))
  const [unitPrice, setUnitPrice] = useState(formatField(line.unitPrice))
  const [discount, setDiscount] = useState(formatField(line.discount))
  const [busy, setBusy] = useState(false)

  useEffect(() => setTitle(line.title), [line.title])
  useEffect(() => setDescription(line.description), [line.description])
  useEffect(() => setQuantity(formatField(line.quantity)), [line.quantity])
  useEffect(() => setUnitPrice(formatField(line.unitPrice)), [line.unitPrice])
  useEffect(() => setDiscount(formatField(line.discount)), [line.discount])

  async function commitIfChanged() {
    if (busy) return
    const next: LineFormPayload = {
      title: title.trim(),
      description: description.trim(),
      quantity: parseNum(quantity, 1),
      unitPrice: parseNum(unitPrice, 0),
      discount: parseNum(discount, 0),
    }
    const same =
      next.title === line.title &&
      next.description === line.description &&
      next.quantity === line.quantity &&
      next.unitPrice === line.unitPrice &&
      next.discount === line.discount
    if (same) return
    if (!next.title) {
      setTitle(line.title)
      return
    }
    if (!Number.isFinite(next.quantity) || next.quantity <= 0) {
      setQuantity(formatField(line.quantity))
      return
    }
    if (!Number.isFinite(next.unitPrice) || next.unitPrice < 0) {
      setUnitPrice(formatField(line.unitPrice))
      return
    }

    setBusy(true)
    try {
      await onUpdate(line.id, next)
    } catch {
      setTitle(line.title)
      setDescription(line.description)
      setQuantity(formatField(line.quantity))
      setUnitPrice(formatField(line.unitPrice))
      setDiscount(formatField(line.discount))
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
      ;(e.target as HTMLInputElement).blur()
    }
  }

  return (
    <tr className='border-t border-gray-100 align-top' data-testid='invoice-line-row' data-line-id={line.id}>
      <td className='px-3 py-2.5'>
        <input
          className={cellInputCls + ' font-medium text-gray-900'}
          data-testid='invoice-line-title'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={onKeyDown}
          placeholder={t('billing.editor.lines.titlePlaceholder')}
          disabled={busy}
        />
        <input
          className={cellSubInputCls}
          data-testid='invoice-line-description'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={onKeyDown}
          placeholder={t('billing.editor.lines.descriptionPlaceholder')}
          disabled={busy}
        />
      </td>
      <td className='px-2 py-2.5'>
        <input
          type='number'
          step='0.01'
          min='0.01'
          className={cellInputCls + ' tabular-nums text-end'}
          data-testid='invoice-line-quantity'
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
      </td>
      <td className='px-2 py-2.5'>
        <input
          type='number'
          step='0.01'
          min='0'
          className={cellInputCls + ' tabular-nums text-end'}
          data-testid='invoice-line-unit-price'
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
      </td>
      <td className='px-2 py-2.5'>
        <input
          type='number'
          step='0.01'
          min='0'
          className={cellInputCls + ' tabular-nums text-end'}
          data-testid='invoice-line-discount'
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
      </td>
      <td className='px-3 py-3.5 tabular-nums font-bold text-end text-gray-900 align-middle text-lg' data-testid='invoice-line-total'>
        {formatCurrency(line.lineTotal)}
      </td>
      <td className='px-2 py-2.5 text-center align-middle'>
        <Btn variant='ghost' size='small' icon='trash' onClick={onAskDelete} disabled={busy} data-testid='invoice-line-delete' />
      </td>
    </tr>
  )
}
