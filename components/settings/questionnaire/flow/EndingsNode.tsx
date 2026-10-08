'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { chosenSentence } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
import { updateEnding } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { rowsFor } from '../builderCopy'
import { useFlowEditor } from './flowContext'

/**
 * Where every route ends: what the customer receives when we are done.
 *
 * One box, never one per ending. At rest it reads like the last message; open,
 * every message is editable in place, each special ending headed in words
 * ("אם הלקוח בחר חתונה"). Choosing WHO receives a special ending is the one
 * thing left to the list view, and the link there says so.
 */
export default function EndingsNode({ selected }: NodeProps) {
  const { model, view, edit, issuesFor, leave, select, openConversation } = useFlowEditor()
  const custom = model.endings.custom
  const missing = issuesFor('endings').some((i) => i.field === 'standardEnding')

  if (!selected) {
    return (
      <div dir='rtl' className='grid w-[300px] gap-1.5'>
        <Handle type='target' position={Position.Top} id='in' isConnectable={false} className='!opacity-0' />
        <div className='flex items-center justify-between'>
          <p className='text-xs text-gray-500'>בסוף השיחה הלקוח מקבל:</p>
          <button type='button' onClick={() => select('endings')} aria-label='עריכת הודעות הסיום' className='nodrag rounded px-1.5 text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary'>
            עריכה
          </button>
        </div>
        <p className={`line-clamp-3 whitespace-pre-line rounded-2xl rounded-br-sm bg-gray-100 px-3 py-2 text-sm leading-relaxed ${missing ? 'ring-1 ring-red-300' : ''}`}>
          {model.endings.standard.trim() || 'עוד לא נכתבה הודעת סיום'}
        </p>
        {custom.map((e, i) => (
          <p key={i} className='truncate px-1 text-xs text-gray-600'>
            {chosenSentence(model, e.sentWhen.conditions[0] ?? null) ?? 'סיום שונה'}: {e.message.split('\n')[0]}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div
      dir='rtl'
      onBlurCapture={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && leave('endings')}
      className='grid w-[340px] gap-3 rounded-xl border border-primary bg-white p-3.5 shadow-sm'
    >
      <Handle type='target' position={Position.Top} id='in' isConnectable={false} className='!opacity-0' />
      <div className='grid gap-1'>
        <label htmlFor='flow-ending' className='text-xs font-semibold text-gray-600'>
          {custom.length ? 'סיום רגיל' : 'בסוף השיחה הלקוח מקבל'}
        </label>
        <textarea
          id='flow-ending'
          value={model.endings.standard}
          rows={rowsFor(model.endings.standard, 2, 8)}
          aria-invalid={missing}
          onChange={(e) => edit((m) => ({ ...m, endings: { ...m.endings, standard: e.target.value } }))}
          className='nodrag nowheel resize-none rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm leading-relaxed focus:outline-2 focus:outline-primary aria-invalid:border-red-400'
        />
        {missing && <p className='text-xs text-red-700'>כתבו הודעת סיום.</p>}
      </div>
      {custom.map((ending, i) => {
        const heading = chosenSentence(model, ending.sentWhen.conditions[0] ?? null) ?? 'סיום שונה, עוד לא נבחר למי'
        const problems = view.endingIssues[i] ?? []
        return (
          <div key={i} className='grid gap-1'>
            <label htmlFor={`flow-ending-${i}`} className='text-xs font-semibold text-gray-600'>
              {heading}
            </label>
            <textarea
              id={`flow-ending-${i}`}
              value={ending.message}
              rows={rowsFor(ending.message, 2, 8)}
              onChange={(e) => edit((m) => updateEnding(m, i, { message: e.target.value }))}
              className='nodrag nowheel resize-none rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm leading-relaxed focus:outline-2 focus:outline-primary'
            />
            {problems.map((p, n) => (
              <p key={n} className='text-xs text-red-700'>
                {p.text}
              </p>
            ))}
          </div>
        )
      })}
      <button type='button' onClick={openConversation} className='nodrag justify-self-start text-xs text-ink underline underline-offset-2'>
        {custom.length ? 'שינוי מי מקבל כל סיום, או הוספת סיום נוסף (ברשימה)' : 'הוספת סיום שונה לפי תשובה (ברשימה)'}
      </button>
    </div>
  )
}
