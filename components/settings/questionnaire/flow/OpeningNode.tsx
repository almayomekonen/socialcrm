'use client'

import { Handle, Position } from '@xyflow/react'
import { useFlowEditor } from './flowContext'

/** Where the conversation starts: the first thing the customer receives, edited in place. */
export default function OpeningNode() {
  const { model, edit, issuesFor, leave, select } = useFlowEditor()
  const missing = issuesFor('opening').some((i) => i.field === 'opening')
  return (
    <div
      dir='rtl'
      onFocusCapture={() => select('opening')}
      onBlurCapture={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && leave('opening')}
      className='grid w-[340px] gap-2 rounded-xl border border-[#25D366]/40 bg-[#25D366]/8 p-3.5 shadow-sm'
    >
      <label htmlFor='flow-opening' className='text-xs font-semibold text-gray-600'>
        הודעת פתיחה
      </label>
      <textarea
        id='flow-opening'
        value={model.opening}
        rows={Math.min(6, Math.max(2, model.opening.split('\n').length))}
        aria-invalid={missing}
        onChange={(e) => edit((m) => ({ ...m, opening: e.target.value }))}
        className='nodrag nowheel resize-none rounded-md border border-transparent bg-white/70 px-2.5 py-2 text-sm leading-relaxed hover:border-gray-200 focus:border-gray-200 focus:bg-white focus:outline-2 focus:outline-primary aria-invalid:border-red-400'
      />
      {missing && <p className='text-xs text-red-700'>כתבו הודעת פתיחה.</p>}
      <Handle type='source' position={Position.Bottom} id='next' isConnectable={false} className='!opacity-0' />
    </div>
  )
}
