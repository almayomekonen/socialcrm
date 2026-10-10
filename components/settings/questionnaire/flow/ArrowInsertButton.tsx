'use client'

import { useFlowEditor } from './flowContext'

/**
 * "+ הוספת שאלה" on the continue arrow that leaves this box: drawn just under
 * the box, where the arrow starts, so it sits on the arrow (each box has at
 * most one continue arrow, so at most one "+"). It belongs to the box in the
 * page as well, so Tab reaches it right after the box's own controls, in
 * conversation order. Quiet until hovered or focused, then it shows its words.
 */
export default function ArrowInsertButton({ nodeId }: { nodeId: string }) {
  const arrow = useFlowEditor().insertAfter(nodeId)
  if (!arrow) return null
  return (
    <button
      type='button'
      dir='rtl'
      aria-label={`הוספת שאלה ${arrow.where}`}
      aria-haspopup='menu'
      aria-expanded={arrow.open}
      onClick={(e) => {
        // Not a click on the box: React Flow would select it for a moment,
        // re-drawing the box (and this button) and losing the focus.
        e.stopPropagation()
        arrow.onOpen(e.currentTarget)
      }}
      style={{ top: '100%', left: '50%', transform: 'translate(-50%, 4px)' }}
      className='nodrag nopan group absolute z-10 flex h-6 min-w-6 items-center justify-center gap-1 rounded-full border border-gray-300 bg-white px-1.5 text-xs font-medium text-primary shadow-sm hover:border-primary focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary aria-expanded:border-primary'
    >
      <span aria-hidden='true' className='text-sm leading-none'>
        +
      </span>
      <span aria-hidden='true' className='max-w-0 overflow-hidden whitespace-nowrap group-hover:max-w-24 group-focus-visible:max-w-24 group-aria-expanded:max-w-24'>
        הוספת שאלה
      </span>
    </button>
  )
}
