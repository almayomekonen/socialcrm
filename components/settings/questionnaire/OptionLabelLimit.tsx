'use client'

import { useState } from 'react'
import { OPTION_LABEL_MAX, WHATSAPP_LIST_ROW_TITLE_MAX, fitsWhatsappList } from '@/lib/inbox/autoresponse/questionnaire/limits'

/**
 * An answer's length, said out loud instead of enforced in silence. Shared by
 * the List view (OptionRow) and the Flow view (FlowOptionRow), so both behave
 * the same:
 *  · a counter, always visible ("30/40");
 *  · input that would pass OPTION_LABEL_MAX is refused as a whole and the
 *    owner is told why: nothing already typed is dropped, and a paste is never
 *    cut to fit (an input's maxLength would do both without a word);
 *  · for a single-choice question, a label over WhatsApp's list row limit says
 *    that the question goes out as the numbered menu (interactive.ts).
 */
export function useOptionLabelInput(onLabel: (label: string) => void) {
  const [refused, setRefused] = useState(false)
  const change = (next: string) => {
    if (next.length > OPTION_LABEL_MAX) return setRefused(true)
    setRefused(false)
    onLabel(next)
  }
  return { refused, change }
}

/** The ids OptionLabelLimit renders, for the input's aria-describedby. */
export function optionLabelDescribedBy(id: string, label: string, singleChoice: boolean): string {
  return [`${id}-count`, `${id}-refused`, singleChoice && !fitsWhatsappList(label) ? `${id}-menu` : null].filter(Boolean).join(' ')
}

export default function OptionLabelLimit({
  id,
  label,
  refused,
  singleChoice,
}: {
  id: string
  label: string
  refused: boolean
  singleChoice: boolean
}) {
  return (
    <div className='grid gap-0.5'>
      <p id={`${id}-count`} className='text-xs text-gray-500'>
        <span className='sr-only'>אורך התשובה: </span>
        <span dir='ltr'>
          {label.length}/{OPTION_LABEL_MAX}
        </span>{' '}
        תווים
      </p>
      <p id={`${id}-refused`} role='status' className='text-xs text-red-600'>
        {refused ? `אפשר עד ${OPTION_LABEL_MAX} תווים בתשובה, ולכן הטקסט האחרון לא נוסף. כדי לשנות, קצרו את התשובה.` : ''}
      </p>
      {singleChoice && !fitsWhatsappList(label) && (
        <p id={`${id}-menu`} className='text-xs text-gray-600'>
          תשובה ארוכה מ־{WHATSAPP_LIST_ROW_TITLE_MAX} תווים: בוואטסאפ השאלה תישלח כרשימה ממוספרת שהלקוח עונה עליה במספר, ולא ככפתורי בחירה.
        </p>
      )}
    </div>
  )
}
