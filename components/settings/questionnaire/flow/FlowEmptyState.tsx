'use client'

import type { NewQuestionKind } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import AddQuestionMenu from './AddQuestionMenu'

/**
 * A questionnaire with no questions: say so, and offer the one next step.
 * "הוספת השאלה הראשונה" opens the same menu as "+ הוספת שאלה לפני הסיום"
 * and adds the question the same way; the opening and ending stay as they are.
 */
export default function FlowEmptyState({ onAdd }: { onAdd: (kind: NewQuestionKind) => void }) {
  return (
    <section
      dir='rtl'
      aria-labelledby='flow-empty-title'
      className='grid w-[min(28rem,calc(100vw-4rem))] justify-items-center gap-3 rounded-xl border border-gray-200 bg-white px-6 py-5 text-center shadow-sm'
    >
      <h2 id='flow-empty-title' className='text-base font-semibold text-ink'>
        עוד אין שאלות בשאלון
      </h2>
      <p className='text-sm leading-relaxed text-gray-600'>
        כדי שהשאלון ישאל את הלקוח משהו, הוסיפו את השאלה הראשונה. אחריה אפשר להוסיף עוד שאלות בכל שלב.
      </p>
      <AddQuestionMenu onAdd={onAdd} disabledReason={null} label='הוספת השאלה הראשונה' opens='above' />
    </section>
  )
}
