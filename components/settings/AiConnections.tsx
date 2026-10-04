'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { disconnectAiConnection } from '@/actions/oauthGrants'
import type { AiConnectionView } from '@/lib/oauth/server/connections'

/**
 * חיבורי AI — the signed-in user's own connected AI apps (Claude, ChatGPT, …),
 * one row each, each with its own disconnect. Card shell copied from
 * CalendarConnect so it sits in the כלים מחוברים grid as the same component
 * family. No connect button: a connection always starts inside the AI app.
 * Everything shown is precomputed on the server (dates included).
 */
export default function AiConnections({ connections }: { connections: AiConnectionView[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<AiConnectionView | null>(null)
  const [, startTransition] = useTransition()

  async function handleDisconnect() {
    const target = pending
    if (!target) return
    try {
      const res = await disconnectAiConnection(target.grantId)
      if (!res.ok) throw new Error('failed')
      toast('success', `${target.clientLabel} נותק`)
      setPending(null)
      startTransition(() => router.refresh())
    } catch {
      toast('error', 'הניתוק נכשל. נסה שוב.')
    }
  }

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-6 flex flex-col gap-4'>
      <div className='flex items-center gap-2.5'>
        {/* h3: the page owns h1, and "כלים מחוברים" owns the h2 above this card. */}
        <h3 className='text-lg font-bold'>חיבורי AI</h3>
        {connections.length > 0 && <Icon name='check' type='reg' className='size-4 bg-green-600' aria-label='מחובר' />}
      </div>

      <p className='text-gray-600 text-sm leading-relaxed'>
        שאלו את Claude או את ChatGPT על הלידים, המעקבים והשיחות שלכם. החיבור קורא נתונים בלבד ואינו מקבל מספרי טלפון או אימיילים.
      </p>

      {connections.length === 0 ? (
        <div className='mt-auto flex items-center justify-between gap-3'>
          <span className='text-sm text-gray-400'>לא מחובר</span>
          <span className='text-sm text-gray-600'>החיבור מתבצע מתוך Claude או ChatGPT</span>
        </div>
      ) : (
        <ul className='mt-auto flex flex-col gap-4'>
          {connections.map((c) => (
            <li key={c.grantId} className='flex flex-col gap-2 border-t border-gray-100 pt-4 first:border-t-0 first:pt-0'>
              <div className='flex items-center justify-between gap-3'>
                <span className='min-w-0 text-sm text-gray-600'>
                  <span className='font-medium text-gray-800'>{c.clientLabel}</span> · מחובר מאז {c.connectedOn} · שימוש אחרון{' '}
                  {c.lastUsedOn ?? '—'}
                </span>
                <Btn lbl={`נתק את ${c.clientLabel}`} variant='outline' onClick={() => setPending(c)} />
              </div>
              <ul className='list-disc ps-5 text-xs text-gray-600'>
                {c.scopeLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <ConfirmPop
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={handleDisconnect}
        msg={
          pending
            ? `${pending.clientLabel} לא יוכל עוד לקרוא את הלידים והשיחות שלך.\nניתן להתחבר שוב מתוך ${pending.clientLabel} בכל עת.`
            : ''
        }
        confirmLbl={pending ? `נתק את ${pending.clientLabel}` : 'נתק'}
        destructive
      />
    </div>
  )
}
