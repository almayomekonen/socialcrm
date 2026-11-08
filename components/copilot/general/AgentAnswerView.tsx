'use client'

import type { AgentResult } from '@/lib/agent/types'
import type { AgentAskFailure } from '@/lib/copilot/general/agentClient'

/**
 * Renders one Agent investigation inside the General Mode transcript.
 *
 * It borrows the reasoned-answer card in AnswerView rather than inventing a
 * second answer style: bordered card, semibold headline, a list beneath it, a
 * muted tail. The Agent's shape happens to fit that card exactly — a conclusion
 * the rep reads first, the claims it rests on, and what could not be determined.
 *
 * WHAT IS DELIBERATELY NOT SHOWN. Evidence refs, step counts, stop reasons and
 * `investigationId` are all present on the result and none of them reach the
 * screen: they are how support traces an answer, not something a נציג acts on.
 * Persistence status is not surfaced either — the write is fire-and-forget, and
 * saying "not saved" would imply the answer itself is suspect.
 */

const REFUSAL: Record<string, string> = {
  no_evidence: 'לא מצאתי מספיק נתונים כדי לענות על זה.',
  error: 'לא הצלחתי לענות כרגע. נסה שוב.',
}

/**
 * Admission reasons, in the product's own words. These mirror what the rest of
 * the product already says about the same states — the panel does not invent a
 * second authorization vocabulary.
 */
const DENIAL: Record<string, string> = {
  'over-quota': 'הגעת למכסת השימוש היומית. נסה שוב מחר.',
  'subscription-required': 'חידוש המנוי מחזיר את העוזר החכם.',
  'trial-not-started': 'תקופת הניסיון עוד לא התחילה.',
  'ai-credits-exhausted': 'נוצלו הבקשות הכלולות החודש. אפשר להוסיף קרדיטים בעמוד מנוי ותשלום; ה-CRM ממשיך לעבוד כרגיל.',
  forbidden: 'העוזר עדיין לא זמין בחשבון הזה.',
  disabled: 'העוזר לא זמין כרגע.',
  'no-providers': 'העוזר לא זמין כרגע.',
}

export const TRANSPORT_COPY: Record<AgentAskFailure, string> = {
  unauthorized: 'צריך להתחבר מחדש כדי להמשיך.',
  'subscription-required': 'חידוש המנוי מחזיר את העוזר החכם.',
  'trial-not-started': 'תקופת הניסיון עוד לא התחילה.',
  'agent-disabled': 'העוזר עדיין לא זמין בחשבון הזה.',
  'invalid-question': 'לא הצלחתי לקרוא את השאלה. נסה לנסח אותה שוב.',
  unavailable: 'לא הצלחתי לענות כרגע. נסה שוב.',
}

function Note({ text }: { text: string }) {
  return <p className='text-sm text-gray-500'>{text}</p>
}

export function AgentErrorView({ reason }: { reason: AgentAskFailure }) {
  return <Note text={TRANSPORT_COPY[reason] ?? TRANSPORT_COPY.unavailable} />
}

export default function AgentAnswerView({ result }: { result: AgentResult }) {
  if (result.ok === false) {
    if (result.reason === 'gate_denied') {
      return <Note text={DENIAL[result.message ?? ''] ?? TRANSPORT_COPY.unavailable} />
    }
    return <Note text={REFUSAL[result.reason] ?? TRANSPORT_COPY.unavailable} />
  }

  const { headline, claims, unknown } = result.answer
  return (
    <div className='rounded-md border border-gray-200 p-2.5 space-y-2'>
      <p className='text-sm font-semibold text-gray-900'>{headline}</p>
      {claims.length > 0 && (
        <ul className='space-y-1.5'>
          {claims.map((c, i) => (
            <li key={i} className='text-[13px] text-gray-700'>
              {c.text}
            </li>
          ))}
        </ul>
      )}
      {unknown && <p className='text-[12px] text-gray-500'>{unknown}</p>}
    </div>
  )
}
