'use client'

import { useState } from 'react'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import LineRow from './lines/LineRow'
import NewLineRow from './lines/NewLineRow'
import type { EditableLine, LineFormPayload } from './lines/types'

export type { EditableLine, LineFormPayload } from './lines/types'

/**
 * The invoice lines table. Thin orchestrator: renders the table chrome
 * + maps line rows + owns the delete-confirm state. All row internals
 * (state, validation, commit semantics, styling) live in:
 *   - lines/LineRow.tsx       — existing-line inline editor
 *   - lines/NewLineRow.tsx    — compose row
 *   - lines/types.ts          — shared types + cell styles + helpers
 */

type Props = {
  lines: readonly EditableLine[]
  onAdd: (payload: LineFormPayload) => Promise<void> | void
  onUpdate: (lineId: number, payload: LineFormPayload) => Promise<void> | void
  onRemove: (lineId: number) => Promise<void> | void
}

export default function InvoiceLinesEditor({ lines, onAdd, onUpdate, onRemove }: Props) {
  const [lineToDelete, setLineToDelete] = useState<EditableLine | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function performDelete() {
    const line = lineToDelete
    if (!line || deleting) return
    setDeleting(true)
    try {
      await onRemove(line.id)
      setLineToDelete(null)
    } catch {
      // parent surfaced its toast; keep dialog open for retry
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className='overflow-x-auto'>
      <table className='w-full text-base'>
        <thead className='text-right text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 border-b border-gray-100 bg-gray-50/30'>
          <tr>
            <th className='px-4 py-3.5 font-semibold w-[42%]'>תיאור</th>
            <th className='px-3 py-3.5 font-semibold w-[10%] text-end'>כמות</th>
            <th className='px-3 py-3.5 font-semibold w-[14%] text-end'>מחיר יחידה</th>
            <th className='px-3 py-3.5 font-semibold w-[12%] text-end'>הנחה</th>
            <th className='px-3 py-3.5 font-semibold w-[16%] text-end'>סה"כ שורה</th>
            <th className='px-2 py-3.5 w-[6%]'></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <LineRow key={line.id} line={line} onUpdate={onUpdate} onAskDelete={() => setLineToDelete(line)} />
          ))}
          <NewLineRow onAdd={onAdd} />
        </tbody>
      </table>

      <ConfirmPop
        open={!!lineToDelete}
        destructive
        confirmLbl='מחק פריט'
        msg={lineToDelete ? `למחוק את הפריט "${lineToDelete.title}"?` : ''}
        onClose={() => (deleting ? null : setLineToDelete(null))}
        onConfirm={performDelete}
      />
    </div>
  )
}
