'use client'

import { useId } from 'react'
import { disableOther, enableOther, otherOf, questionsFull } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { otherBlockedReason } from '../builderCopy'
import { useFlowEditor } from './flowContext'

/**
 * The map's "אפשר לבחור 'אחר'": the option and its follow-up question, turned
 * on and off together (editorOptions.ts). When there is no room for them (10
 * answers, or 12 questions) it is unavailable and says why, as the List
 * view's switch does.
 */
export default function FlowOtherToggle({ questionKey, optionCount }: { questionKey: string; optionCount: number }) {
  const { model, edit, confirm } = useFlowEditor()
  const id = useId()
  const other = otherOf(model, questionKey)
  const blocked = otherBlockedReason({ hasOther: other !== null, optionsFull: optionCount >= 10, questionsFull: questionsFull(model) })

  return (
    <div className='grid gap-0.5'>
      <label className='flex items-center gap-1.5 text-xs text-gray-700'>
        <input
          type='checkbox'
          className='size-4 accent-solid'
          checked={other !== null}
          disabled={blocked !== null}
          aria-describedby={blocked ? `${id}-why` : undefined}
          onChange={(e) =>
            e.target.checked
              ? edit((m) => enableOther(m, questionKey))
              : other?.followUp
                ? confirm({
                    msg: `להסיר את "${other.option.label}"?\nגם שאלת ההמשך שלה תימחק.`,
                    confirmLbl: `הסרת "${other.option.label}"`,
                    destructive: true,
                    run: () => edit((m) => disableOther(m, questionKey)),
                  })
                : edit((m) => disableOther(m, questionKey))
          }
        />
        אפשר לבחור "אחר"
      </label>
      {blocked && (
        <p id={`${id}-why`} className='text-xs text-gray-600'>
          {blocked}
        </p>
      )}
    </div>
  )
}
