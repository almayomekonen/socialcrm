'use client'

import { Handle, Position } from '@xyflow/react'
import { describeCondition } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
import { useFlowEditor } from './flowContext'

/**
 * How every route ends. One box, not one per ending: which customers get a
 * different ending is said in words, so routes do not fan out into several
 * end boxes. Editing a different ending happens in the Conversation view.
 */
export default function EndingsNode() {
  const { model, edit, issuesFor, leave, select, openConversation } = useFlowEditor()
  const custom = model.endings.custom
  const missing = issuesFor('endings').some((i) => i.field === 'standardEnding')
  return (
    <div
      dir='rtl'
      onFocusCapture={() => select('endings')}
      onBlurCapture={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && leave('endings')}
      className='grid w-[340px] gap-2 rounded-xl border border-gray-300 bg-gray-50 p-3.5 shadow-sm'
    >
      <Handle type='target' position={Position.Top} id='in' isConnectable={false} className='!opacity-0' />
      <label htmlFor='flow-ending' className='text-xs font-semibold text-gray-600'>
        סיום השיחה
      </label>
      <textarea
        id='flow-ending'
        value={model.endings.standard}
        rows={Math.min(6, Math.max(2, model.endings.standard.split('\n').length))}
        aria-invalid={missing}
        onChange={(e) => edit((m) => ({ ...m, endings: { ...m.endings, standard: e.target.value } }))}
        className='nodrag nowheel resize-none rounded-md border border-transparent bg-white px-2.5 py-2 text-sm leading-relaxed hover:border-gray-200 focus:border-gray-200 focus:outline-2 focus:outline-primary aria-invalid:border-red-400'
      />
      {missing && <p className='text-xs text-red-700'>כתבו הודעת סיום.</p>}
      {custom.length > 0 && (
        <div className='grid gap-1.5 border-t border-gray-200 pt-2'>
          <p className='text-xs font-semibold text-gray-600'>סיום שונה לפי תשובה</p>
          <ul className='grid gap-1'>
            {custom.map((e, i) => (
              <li key={i} className='text-xs leading-relaxed text-gray-700'>
                {describeCondition(model, e.sentWhen.conditions[0] ?? null) ?? 'עוד לא נבחר מתי'}
              </li>
            ))}
          </ul>
          <button type='button' onClick={openConversation} className='nodrag justify-self-start text-xs font-medium text-ink underline underline-offset-2'>
            עריכת הסיומים השונים
          </button>
        </div>
      )}
    </div>
  )
}
