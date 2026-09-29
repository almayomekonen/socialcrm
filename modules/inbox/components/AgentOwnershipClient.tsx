'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Bot, UserRound } from 'lucide-react'
import { returnToAgent, takeOverConversation } from '@/actions/inbox/agentOwnership'

/**
 * One line above the thread saying who is answering, with the one action that
 * changes it.
 *
 * Matches the OperatorTake banner's geometry exactly — same margins, border,
 * radius and icon size — because it occupies the same slot and two banners with
 * different shapes read as two different products.
 *
 * ONE ACTION, NEVER TWO. The agent is either answering or it is not, so there is
 * exactly one thing to do about it. A pair of buttons would make the rep decide
 * which state they are in before deciding what they want.
 */
export type HandoffSummaryView = {
  name: string | null
  businessType: string | null
  need: string | null
  urgency: string | null
  temperature: string | null
  /** Label/value rows written by a deterministic questionnaire, if any. */
  fields?: Array<{ label: string; value: string }> | null
}

type Props = {
  conversationId: number
  humanOwned: boolean
  /** The agent handed off because the customer asked for a person. */
  handedOff: boolean
  /**
   * The operator note written at handoff. Present whenever the conversation is
   * waiting for a rep — independent of the analysis worker's own summary row,
   * whose absence used to hide these entirely.
   */
  handoff?: HandoffSummaryView | null
  /**
   * This business answers with a fixed questionnaire, not the AI agent.
   *
   * It changes what the line can honestly say. "הסוכן עונה בשיחה הזו" is wrong
   * for a script, and "החזרת המענה לסוכן" offers something that will not
   * happen: a questionnaire that has ended does not resume, so the control is
   * withheld rather than left there to be pressed for nothing.
   */
  questionnaireMode?: boolean
  /** True while a questionnaire is still running on this conversation. */
  questionnaireActive?: boolean
  /**
   * The AI reply is switched on, but this agency's plan does not include it, so
   * nothing is answering automatically. Informational only: there is no
   * ownership decision to offer, so no button.
   */
  pausedForPlan?: boolean
}

const ERROR_COPY: Record<string, string> = {
  opted_out: 'הלקוח ביקש לא לקבל הודעות, ולכן המענה האוטומטי לא יחזור לשיחה הזו.',
  closed: 'השיחה הסתיימה. המענה האוטומטי לא יחזור אליה.',
  forbidden: 'אין לך הרשאה לשנות את זה.',
  failed: 'לא הצלחנו לעדכן. נסו שוב.',
  'invalid-input': 'לא הצלחנו לעדכן. נסו שוב.',
}

export default function AgentOwnershipClient({
  conversationId,
  humanOwned,
  handedOff,
  handoff = null,
  questionnaireMode = false,
  questionnaireActive = false,
  pausedForPlan = false,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (action: (id: number) => Promise<{ ok: boolean; reason?: string }>) => {
    setError(null)
    startTransition(async () => {
      const res = await action(conversationId)
      if (!res.ok) setError(ERROR_COPY[res.reason ?? 'failed'] ?? ERROR_COPY.failed)
    })
  }

  if (pausedForPlan) {
    return (
      <div className='mx-4 my-2 shrink-0 rounded-lg border border-gray-200 bg-white px-4 py-3'>
        <div className='flex items-start gap-3'>
          <Bot aria-hidden className='mt-0.5 size-4 shrink-0 text-gray-500' />
          <div className='min-w-0 flex-1'>
            <p className='text-sm text-gray-900'>
              המענה האוטומטי מושהה: התוכנית הנוכחית לא כוללת מענה AI, ולכן הלקוח לא קיבל תשובה אוטומטית.
            </p>
            <Link href='/settings/auto-response' className='mt-1 inline-block text-xs font-medium text-blue-600 hover:underline'>
              לפרטים בהגדרות המענה האוטומטי
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const status = humanOwned
    ? handedOff
      ? 'הפנייה הועברה אליכם. המשך הטיפול בידי הצוות.'
      : questionnaireMode
        ? 'אתם עונים בשיחה הזו. השאלון לא ישלח הודעות נוספות.'
        : 'אתם עונים בשיחה הזו. הסוכן לא ישלח הודעות עד שתחזירו לו אותה.'
    : questionnaireMode
      ? 'שאלון אוטומטי עונה בשיחה הזו.'
      : 'הסוכן עונה בשיחה הזו.'

  // name / business type / request / urgency — only what the customer actually
  // said. A field nobody supplied is omitted rather than shown as a dash.
  // A questionnaire supplies its own labels, because its questions are the
  // business's own. Everything else uses the four the agent extracts.
  const details: Array<{ label: string; value: string }> =
    handoff?.fields && handoff.fields.length ? [...handoff.fields] : []
  if (!details.length) {
    if (handoff?.name) details.push({ label: 'שם', value: handoff.name })
    if (handoff?.businessType) details.push({ label: 'סוג העסק', value: handoff.businessType })
    if (handoff?.need) details.push({ label: 'הפנייה', value: handoff.need })
    if (handoff?.urgency) details.push({ label: 'דחיפות', value: handoff.urgency })
  }

  return (
    <div className='mx-4 my-2 shrink-0 rounded-lg border border-gray-200 bg-white px-4 py-3'>
      <div className='flex items-start justify-between gap-3'>
        {humanOwned ? (
          <UserRound aria-hidden className='mt-0.5 size-4 shrink-0 text-gray-500' />
        ) : (
          <Bot aria-hidden className='mt-0.5 size-4 shrink-0 text-accent' />
        )}
        <div className='min-w-0 flex-1'>
          {handedOff && (
            <p className='mb-1.5 flex flex-wrap items-center gap-1.5'>
              <span className='rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800'>
                ממתין לטיפול נציג
              </span>
              {handoff?.urgency && (
                <span className='rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800'>
                  דחיפות: {handoff.urgency}
                </span>
              )}
            </p>
          )}
          <p className='text-sm text-gray-900'>{status}</p>
          {details.length > 0 && (
            <dl className='mt-2 space-y-0.5'>
              {details.map((d) => (
                <div key={d.label} className='flex gap-1.5 text-xs leading-relaxed'>
                  <dt className='shrink-0 text-gray-500'>{d.label}:</dt>
                  <dd className='min-w-0 text-gray-800'>{d.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {error ? (
            <p role='alert' className='mt-1 text-xs text-red-600'>
              {error}
            </p>
          ) : null}
        </div>
        {humanOwned && questionnaireMode && !questionnaireActive ? null : humanOwned ? (
          <button
            type='button'
            onClick={() => run(returnToAgent)}
            disabled={pending}
            className='shrink-0 text-xs font-medium text-blue-600 hover:underline disabled:opacity-60'
          >
            {pending ? 'מעדכן…' : questionnaireMode ? 'החזרת המענה לשאלון' : 'החזרת המענה לסוכן'}
          </button>
        ) : (
          <button
            type='button'
            onClick={() => run(takeOverConversation)}
            disabled={pending}
            className='shrink-0 text-xs font-medium text-blue-600 hover:underline disabled:opacity-60'
          >
            {pending ? 'מעדכן…' : 'אני עונה מכאן'}
          </button>
        )}
      </div>
    </div>
  )
}
