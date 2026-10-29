'use client'

import { useState } from 'react'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'
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
  const t = useT()
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
        <thead className={`${t.locale === 'he' ? 'text-right' : 'text-start'} text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 border-b border-gray-100 bg-gray-50/30`}>
          <tr>
            <th className='px-4 py-3.5 font-semibold w-[42%]'>{t('billing.editor.lines.header.description')}</th>
            <th className='px-3 py-3.5 font-semibold w-[10%] text-end'>{t('billing.editor.lines.header.quantity')}</th>
            <th className='px-3 py-3.5 font-semibold w-[14%] text-end'>{t('billing.editor.lines.header.unitPrice')}</th>
            <th className='px-3 py-3.5 font-semibold w-[12%] text-end'>{t('billing.editor.lines.header.discount')}</th>
            <th className='px-3 py-3.5 font-semibold w-[16%] text-end'>{t('billing.editor.lines.header.lineTotal')}</th>
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
        confirmLbl={t('billing.editor.lines.deleteConfirm')}
        msg={lineToDelete ? t('billing.editor.lines.deleteMsg', { title: lineToDelete.title }) : ''}
        translated
        onClose={() => (deleting ? null : setLineToDelete(null))}
        onConfirm={performDelete}
      />
    </div>
  )
}
