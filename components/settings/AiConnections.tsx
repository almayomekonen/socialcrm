'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { disconnectAiConnection } from '@/actions/oauthGrants'
import { CopyRow } from '@/components/settings/connections/SetupGuidePanel'
import type { AiConnectionView } from '@/lib/oauth/server/connections'

/**
 * חיבורי AI — the signed-in user's own connected AI apps (Claude, ChatGPT, …),
 * one row each, each with its own disconnect. Card shell copied from
 * CalendarConnect so it sits in the כלים מחוברים grid as the same component
 * family. No connect button: a connection always starts inside the AI app.
 * Everything shown is precomputed on the server (dates included).
 */
/**
 * "איך מתחברים?" — a closed-by-default native <details> (same pattern as
 * PlanIncludesDisclosure), so the card stays compact and the steps work without
 * JavaScript. The URL is the server-configured MCP resource, passed in.
 */
function HowToConnect({ mcpUrl }: { mcpUrl: string | null }) {
  return (
    <details className='group/howto'>
      <summary className='flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm text-solid [&::-webkit-details-marker]:hidden'>
        <Icon
          name='chevron-down'
          type='reg'
          className='size-3 bg-solid transition-transform duration-200 group-open/howto:rotate-180'
        />
        איך מתחברים?
      </summary>
      <ol className='mt-2.5 list-decimal space-y-1.5 ps-5 text-sm text-gray-600'>
        <li>פותחים את Claude או ChatGPT</li>
        <li>מוסיפים חיבור MCP חדש</li>
        <li>{mcpUrl ? <CopyRow label='מזינים:' value={mcpUrl} /> : 'מזינים את כתובת החיבור של SocialCRM'}</li>
        <li>מתחברים ל-SocialCRM ומאשרים הרשאה</li>
      </ol>
    </details>
  )
}

export default function AiConnections({
  connections,
  mcpUrl = null,
}: {
  connections: AiConnectionView[]
  mcpUrl?: string | null
}) {
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
    // Spans both grid columns from tablet up, so the card stays short and a
    // scope label fits on one line on desktop; one column on mobile.
    <div className='col-span-2 mobile:col-span-1 rounded-lg border border-gray-200 bg-white p-6 flex flex-col gap-4'>
      <div className='flex items-center gap-2.5'>
        {/* h3: the page owns h1, and "כלים מחוברים" owns the h2 above this card. */}
        <h3 className='text-lg font-bold'>חיבורי AI</h3>
        {connections.length > 0 && <Icon name='check' type='reg' className='size-4 bg-green-600' aria-label='מחובר' />}
      </div>

      <div className='flex flex-col gap-1'>
        <p className='text-gray-600 text-sm leading-relaxed'>
          חברו את SocialCRM ל-Claude או ChatGPT כדי לשאול על לידים, מעקבים ושיחות.
        </p>
        <p className='text-xs text-gray-500'>הגישה מוגבלת לנתונים שאתם מורשים לראות. מספרי טלפון ואימיילים אינם נשלחים.</p>
      </div>

      {connections.length === 0 ? (
        <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
          <span className='text-sm text-gray-400'>לא מחובר עדיין</span>
          <span className='text-sm text-gray-600'>החיבור מתחיל מתוך Claude או ChatGPT.</span>
        </div>
      ) : (
        <ul className='flex flex-col gap-4'>
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
                  <li key={label} className='desktop:whitespace-nowrap'>
                    {label}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <HowToConnect mcpUrl={mcpUrl} />

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
