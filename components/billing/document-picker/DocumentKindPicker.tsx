'use client'

import ModalPop from '@/lib/modals/ModalPop'
import { DOCUMENT_KINDS, type DocumentKindEntry } from '@/lib/billing/documentKinds'

/**
 * Pre-create document-kind picker. Six options total; only enabled entries
 * are clickable. Disabled rows render the "בקרוב" tag and are visually muted
 * so the user can see the roadmap without being able to pick a half-built
 * flow. New kinds appear automatically by adding entries to DOCUMENT_KINDS.
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
  return (
    <ModalPop open={open} pos='middle' onClose={onClose} className='w-[460px] max-w-[92vw]'>
      <div className='grid gap-4'>
        <header>
          <h2 className='text-xl font-bold text-dark'>איזה מסמך להפיק?</h2>
        </header>

        <ul className='grid gap-1'>
          {DOCUMENT_KINDS.map((entry) => (
            <li key={entry.id}>
              <KindRow entry={entry} onPick={onPick} />
            </li>
          ))}
        </ul>

        <p className='text-sm text-gray-500 border-t border-gray-100 pt-3'>
          לא בטוחים מה סוג המסמך שאתם צריכים להוציא?
        </p>
      </div>
    </ModalPop>
  )
}

function KindRow({
  entry,
  onPick,
}: {
  entry: DocumentKindEntry
  onPick: (entry: DocumentKindEntry) => void
}) {
  if (!entry.enabled) {
    return (
      <div className='flex items-center justify-between gap-3 px-3 py-3 rounded-md text-gray-400 cursor-not-allowed select-none'>
        <span className='text-base'>{entry.label}</span>
        <span className='text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-500'>בקרוב</span>
      </div>
    )
  }

  return (
    <button
      type='button'
      onClick={() => onPick(entry)}
      className='w-full text-right px-3 py-3 rounded-md text-base text-gray-900 bg-softy/40 hover:bg-softy/70 transition-colors font-medium'
    >
      {entry.label}
    </button>
  )
}
