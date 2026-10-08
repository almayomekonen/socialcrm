'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { rowsFor } from '../builderCopy'
import { useFlowEditor } from './flowContext'

/**
 * Where the conversation starts: the customer writes, and this is the first
 * thing they receive. Drawn as a WhatsApp message, not as a question box.
 */
export default function OpeningNode({ selected }: NodeProps) {
  const { model, edit, issuesFor, leave, select } = useFlowEditor()
  const missing = issuesFor('opening').some((i) => i.field === 'opening')

  if (!selected) {
    return (
      <div dir='rtl' className='grid w-[300px] gap-1.5'>
        <div className='flex items-center justify-between'>
          <p className='text-xs text-gray-500'>לקוח שולח הודעה ומקבל:</p>
          <button type='button' onClick={() => select('opening')} aria-label='עריכת הודעת הפתיחה' className='nodrag rounded px-1.5 text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary'>
            עריכה
          </button>
        </div>
        <p className={`line-clamp-4 whitespace-pre-line rounded-2xl rounded-bl-sm bg-[#25D366]/15 px-3 py-2 text-sm leading-relaxed ${missing ? 'ring-1 ring-red-300' : ''}`}>
          {model.opening.trim() || 'עוד לא נכתבה הודעת פתיחה'}
        </p>
        <Handle type='source' position={Position.Bottom} id='next' isConnectable={false} className='!opacity-0' />
      </div>
    )
  }

  return (
    <div
      dir='rtl'
      onBlurCapture={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && leave('opening')}
      className='grid w-[340px] gap-2 rounded-xl border border-primary bg-white p-3.5 shadow-sm'
    >
      <label htmlFor='flow-opening' className='text-xs font-semibold text-gray-600'>
        הודעת הפתיחה (נשלחת יחד עם השאלה הראשונה)
      </label>
      <textarea
        id='flow-opening'
        value={model.opening}
        rows={rowsFor(model.opening, 2, 8)}
        aria-invalid={missing}
        onChange={(e) => edit((m) => ({ ...m, opening: e.target.value }))}
        className='nodrag nowheel resize-none rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm leading-relaxed focus:outline-2 focus:outline-primary aria-invalid:border-red-400'
      />
      {missing && <p className='text-xs text-red-700'>כתבו הודעת פתיחה.</p>}
      <Handle type='source' position={Position.Bottom} id='next' isConnectable={false} className='!opacity-0' />
    </div>
  )
}
