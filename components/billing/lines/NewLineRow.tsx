'use client'

import { useRef, useState } from 'react'
import { cellInputCls, cellSubInputCls, parseNum, type LineFormPayload } from './types'

/**
 * Compose-row at the bottom of the lines table. The "+ פריט חדש"
 * surface — typed values stay local until the user explicitly
 * commits via Enter or focus-leaves-the-row blur.
 *
 * Commit requires title + price (>0) + quantity (>0). Empty price is
 * the signal "user hasn't finished yet" — no phantom $0 rows on tab.
 */
export default function NewLineRow({ onAdd }: { onAdd: (payload: LineFormPayload) => Promise<void> | void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('')
  const [discount, setDiscount] = useState('')
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLTableRowElement>(null)

  function reset(refocus: boolean) {
    setTitle('')
    setDescription('')
    setQuantity('1')
    setUnitPrice('')
    setDiscount('')
    if (refocus) titleRef.current?.focus()
  }

  async function tryCommit({ refocus }: { refocus: boolean }) {
    if (busy) return
    const t = title.trim()
    if (!t) return
    if (!unitPrice.trim()) return
    const q = parseNum(quantity, 0)
    const u = parseNum(unitPrice, 0)
    if (q <= 0 || u < 0) return

    setBusy(true)
    try {
      await onAdd({
        title: t,
        description: description.trim(),
        quantity: q,
        unitPrice: u,
        discount: parseNum(discount, 0),
      })
      reset(refocus)
    } catch {
      // parent surfaced its toast; keep the row populated so the user can fix and retry
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void tryCommit({ refocus: true })
    }
  }

  function onRowBlur(e: React.FocusEvent<HTMLTableRowElement>) {
    if (rowRef.current?.contains(e.relatedTarget as Node | null)) return
    void tryCommit({ refocus: false })
  }

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className='border-t border-gray-100 align-top bg-softy/50' data-testid='invoice-newline-row'>
      <td className='px-3 py-2.5'>
        <input
          ref={titleRef}
          className={cellInputCls + ' font-medium text-gray-900 placeholder:text-solid/70 bg-white!'}
          data-testid='invoice-newline-title'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='+ פריט חדש'
          disabled={busy}
        />
        {title && (
          <input
            className={cellSubInputCls + ' bg-white!'}
            data-testid='invoice-newline-description'
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder='תיאור (אופציונלי)'
            disabled={busy}
          />
        )}
      </td>
      <td className='px-2 py-2.5'>
        <input
          type='number'
          step='0.01'
          min='0.01'
          className={cellInputCls + ' tabular-nums text-end bg-white!'}
          data-testid='invoice-newline-quantity'
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
      </td>
      <td className='px-2 py-2.5'>
        <input
          type='number'
          step='0.01'
          min='0'
          className={cellInputCls + ' tabular-nums text-end bg-white!'}
          data-testid='invoice-newline-unit-price'
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='0'
          disabled={busy}
        />
      </td>
      <td className='px-2 py-2.5'>
        <input
          type='number'
          step='0.01'
          min='0'
          className={cellInputCls + ' tabular-nums text-end bg-white!'}
          data-testid='invoice-newline-discount'
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='0'
          disabled={busy}
        />
      </td>
      <td className='px-3 py-3.5 text-end text-gray-300 align-middle'>—</td>
      <td className='px-2 py-2.5'></td>
    </tr>
  )
}
