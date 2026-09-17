'use client'

import { useState, useTransition } from 'react'
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
}

const ERROR_COPY: Record<string, string> = {
  opted_out: 'הלקוח ביקש לא לקבל הודעות, ולכן המענה האוטומטי לא יחזור לשיחה הזו.',
  closed: 'השיחה הסתיימה. המענה האוטומטי לא יחזור אליה.',
  forbidden: 'אין לך הרשאה לשנות את זה.',
  failed: 'לא הצלחנו לעדכן. נסו שוב.',
  'invalid-input': 'לא הצלחנו לעדכן. נסו שוב.',
}

export default function AgentOwnershipClient({ conversationId, humanOwned, handedOff, handoff = null }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (action: (id: number) => Promise<{ ok: boolean; reason?: string }>) => {
    setError(null)
    startTransition(async () => {
      const res = await action(conversationId)
      if (!res.ok) setError(ERROR_COPY[res.reason ?? 'failed'] ?? ERROR_COPY.failed)
    })
  }

  const status = humanOwned
    ? handedOff
      ? 'הפנייה הועברה אליכם. הסוכן לא ישלח הודעות נוספות.'
      : 'אתם עונים בשיחה הזו. הסוכן לא ישלח הודעות עד שתחזירו לו אותה.'
    : 'הסוכן עונה בשיחה הזו.'

  // name / business type / request / urgency — only what the customer actually
  // said. A field nobody supplied is omitted rather than shown as a dash.
  const details: Array<{ label: string; value: string }> = []
  if (handoff?.name) details.push({ label: 'שם', value: handoff.name })
  if (handoff?.businessType) details.push({ label: 'סוג העסק', value: handoff.businessType })
  if (handoff?.need) details.push({ label: 'הפנייה', value: handoff.need })
  if (handoff?.urgency) details.push({ label: 'דחיפות', value: handoff.urgency })

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
        {humanOwned ? (
          <button
            type='button'
            onClick={() => run(returnToAgent)}
            disabled={pending}
            className='shrink-0 text-xs font-medium text-blue-600 hover:underline disabled:opacity-60'
          >
            {pending ? 'מעדכן…' : 'החזרת המענה לסוכן'}
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
