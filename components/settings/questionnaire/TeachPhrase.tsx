'use client'

import { useMemo } from 'react'
import { previewDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { suggestPhrase, type PhraseSuggestion } from '@/lib/inbox/autoresponse/questionnaire/builder/phraseSuggestion'
import type { SimulatedTurn } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'

/**
 * Under a test turn the questionnaire did not understand: an owner-only note,
 * outside the WhatsApp conversation, offering to teach the questionnaire that
 * these words mean a given answer. Offered only when phraseSuggestion.ts is
 * certain (the runtime's own parser confirms it); otherwise it tells the
 * owner where phrases are added. Nothing changes until the owner clicks.
 */
export default function TeachPhrase({
  model,
  turn,
  onTeach,
}: {
  model: BuilderQuestionnaire
  turn: SimulatedTurn
  onTeach: (s: PhraseSuggestion) => void
}) {
  const e = turn.explanation
  const notUnderstood = e.reason === 'reprompt_invalid_choice' && e.nextQuestionId !== null
  const message = turn.customer[turn.customer.length - 1] ?? ''
  const suggestion = useMemo(() => {
    if (!notUnderstood) return null
    const definition = previewDefinition(model)
    return definition ? suggestPhrase(definition, e.nextQuestionId as string, message) : null
    // The suggestion belongs to the turn as it happened, not to later edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notUnderstood, message, e.nextQuestionId])

  if (!notUnderstood) return null
  return (
    <div role='note' className='self-stretch rounded-md border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-2 text-xs leading-relaxed text-indigo-950'>
      {suggestion ? (
        <div className='grid gap-1.5'>
          <p>
            השאלון לא זיהה את הניסוח הזה. ללמד אותו ש"{suggestion.phrase}" זה "{suggestion.optionLabel}"?
          </p>
          <button
            type='button'
            onClick={() => onTeach(suggestion)}
            className='justify-self-start rounded-md bg-white px-2.5 py-1 font-medium text-ink ring-1 ring-indigo-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-primary'
          >
            הוספה לניסוחים של "{suggestion.optionLabel}"
          </button>
        </div>
      ) : (
        <p>
          השאלון לא זיהה את התשובה. כדי שיבין משפטים כאלה, הוסיפו אותם לתשובה המתאימה, תחת "איך לקוחות יכולים לנסח את זה?".
        </p>
      )}
    </div>
  )
}
