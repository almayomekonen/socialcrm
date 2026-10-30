'use client'

import { useState } from 'react'
import { computeLineTotals } from '@/lib/billing/totals'
import type { EditableLine, LineFormPayload } from '@/components/billing/InvoiceLinesEditor'

/**
 * The new-invoice editor's lines, held in the browser until the draft is
 * saved or issued. Every line is computed at the agency's default rate.
 */
export function useTransientLines(defaultTaxRatePercent: number) {
  const [lines, setLines] = useState<EditableLine[]>([])

  function applyComputed(line: Omit<EditableLine, 'lineSubtotal' | 'lineTaxAmount' | 'lineTotal'>): EditableLine {
    const computed = computeLineTotals(line.quantity, line.unitPrice, line.discount, defaultTaxRatePercent)
    return { ...line, lineSubtotal: computed.subtotal, lineTaxAmount: computed.tax, lineTotal: computed.total }
  }

  function onAddLine(payload: LineFormPayload): void {
    setLines((prev) => [
      ...prev,
      applyComputed({
        id: -Date.now() - prev.length,
        title: payload.title,
        description: payload.description,
        quantity: payload.quantity,
        unitPrice: payload.unitPrice,
        discount: payload.discount,
      }),
    ])
  }

  function onUpdateLine(lineId: number, payload: LineFormPayload): void {
    setLines((prev) =>
      prev.map((line) => (line.id === lineId ? applyComputed({ id: line.id, ...payload }) : line)),
    )
  }

  function onRemoveLine(lineId: number): void {
    setLines((prev) => prev.filter((line) => line.id !== lineId))
  }

  return { lines, setLines, onAddLine, onUpdateLine, onRemoveLine }
}
