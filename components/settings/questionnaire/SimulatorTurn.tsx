'use client'

import type { Translator } from '@/lib/i18n/translate'
import { explainKeptIn, explainReasonIn, explainRecognizedIn } from './issueText'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { PhraseSuggestion } from '@/lib/inbox/autoresponse/questionnaire/builder/phraseSuggestion'
import type { SimulatedTurn } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import ChatBubble from './ChatBubble'
import TeachPhrase from './TeachPhrase'

/**
 * One turn of "בדיקת השאלון": what the owner wrote as a customer, what the
 * questionnaire answered (production output, shown as is), the teaching offer
 * when the editor allows it, and "למה המערכת בחרה בזה?".
 */
export default function SimulatorTurn({
  model,
  turn,
  onTeach,
  t,
}: {
  model: BuilderQuestionnaire
  turn: SimulatedTurn
  /** The test chat's words (Hebrew unless the chat follows the interface language). */
  t: Translator
  /** Editing a draft: offer to teach a phrase the test did not recognise. */
  onTeach?: (s: PhraseSuggestion) => void
}) {
  return (
    <div className='flex flex-col gap-2.5'>
      {turn.customer.map((m, n) => (
        <ChatBubble key={`c${n}`} from='customer' text={m} label={t('admin.questionnaire.simulator.you')} />
      ))}
      {turn.replies.map((r, n) => (
        <ChatBubble key={`r${n}`} from='business' text={r} label={t('admin.questionnaire.simulator.reply')} />
      ))}
      {turn.replies.length === 0 && <p className='self-end text-xs text-gray-500'>{t('admin.questionnaire.simulator.noReply')}</p>}
      {onTeach && <TeachPhrase model={model} turn={turn} onTeach={onTeach} t={t} />}
      <details className='self-end max-w-[88%] text-xs text-gray-600'>
        <summary className='cursor-pointer underline-offset-2 hover:underline'>{t('admin.questionnaire.simulator.why')}</summary>
        <div className='mt-1 grid gap-1 rounded-md border border-gray-200 bg-white p-2'>
          <p>{explainReasonIn(turn.explanation, t)}</p>
          {explainRecognizedIn(model, turn.explanation, t).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {explainKeptIn(turn.explanation, t).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </details>
    </div>
  )
}
