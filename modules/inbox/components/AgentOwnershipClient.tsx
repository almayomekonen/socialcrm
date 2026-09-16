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
type Props = {
  conversationId: number
  humanOwned: boolean
  /** The agent handed off because the customer asked for a person. */
  handedOff: boolean
}

const ERROR_COPY: Record<string, string> = {
  opted_out: 'הלקוח ביקש לא לקבל הודעות, ולכן המענה האוטומטי לא יחזור לשיחה הזו.',
  closed: 'השיחה הסתיימה. המענה האוטומטי לא יחזור אליה.',
  forbidden: 'אין לך הרשאה לשנות את זה.',
  failed: 'לא הצלחנו לעדכן. נסו שוב.',
  'invalid-input': 'לא הצלחנו לעדכן. נסו שוב.',
}

export default function AgentOwnershipClient({ conversationId, humanOwned, handedOff }: Props) {
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
      ? 'הסוכן העביר את השיחה אליכם ולא ישלח הודעות נוספות.'
      : 'אתם עונים בשיחה הזו. הסוכן לא ישלח הודעות עד שתחזירו לו אותה.'
    : 'הסוכן עונה בשיחה הזו.'

  return (
    <div className='mx-4 my-2 shrink-0 rounded-lg border border-gray-200 bg-white px-4 py-3'>
      <div className='flex items-start justify-between gap-3'>
        {humanOwned ? (
          <UserRound aria-hidden className='mt-0.5 size-4 shrink-0 text-gray-500' />
        ) : (
          <Bot aria-hidden className='mt-0.5 size-4 shrink-0 text-accent' />
        )}
        <div className='min-w-0 flex-1'>
          <p className='text-sm text-gray-900'>{status}</p>
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
