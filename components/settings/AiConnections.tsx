'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { disconnectAiConnection } from '@/actions/oauthGrants'
import { CopyRow } from '@/components/settings/connections/SetupGuidePanel'
import type { AiConnectionView } from '@/lib/oauth/server/connections'

/**
 * חיבורי AI — one row per AI app (Claude, ChatGPT, and any other connected MCP
 * client), each with its logo, name, status and its own action. Card shell
 * copied from CalendarConnect so it sits in the כלים מחוברים grid as the same
 * component family. Everything shown is precomputed on the server (dates
 * included).
 *
 * There is no connect button: a connection always starts inside the AI app.
 * A not-connected row offers "הוראות חיבור", which opens the ONE shared
 * "איך מתחברים?" disclosure below the list instead of repeating the steps.
 */

type Provider = { label: string; logo: string | null }

// Logos are local, transparent PNGs (public/media/social-icons). The provider
// name sits right beside each logo, so the image is decorative (alt='').
const KNOWN_PROVIDERS: Provider[] = [
  { label: 'Claude', logo: '/media/social-icons/claude-color.png' },
  { label: 'ChatGPT', logo: '/media/social-icons/openai.png' },
]

const HOWTO_ID = 'ai-connections-howto'

/**
 * "איך מתחברים?" — a closed-by-default native <details> (same pattern as
 * PlanIncludesDisclosure): compact, keyboard-operable, its expanded state is
 * exposed by the browser, and the steps work without JavaScript.
 */
function HowToConnect({ mcpUrl, detailsRef }: { mcpUrl: string | null; detailsRef: React.RefObject<HTMLDetailsElement | null> }) {
  return (
    <details ref={detailsRef} id={HOWTO_ID} className='group/howto'>
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

function ProviderLogo({ src }: { src: string | null }) {
  // Fixed 28px box, object-contain: never stretched or cropped. Unknown
  // clients get a neutral placeholder of the same size so names stay aligned.
  return (
    <span className='flex size-7 shrink-0 items-center justify-center'>
      {src ? (
        <img src={src} alt='' aria-hidden='true' className='max-h-7 max-w-7 object-contain' />
      ) : (
        <Icon name='plug' type='reg' className='size-5 bg-gray-400' />
      )}
    </span>
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
  const howToRef = useRef<HTMLDetailsElement | null>(null)

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

  function openHowTo() {
    const d = howToRef.current
    if (!d) return
    d.open = true
    d.querySelector('summary')?.focus()
  }

  // Claude and ChatGPT always appear; any other connected MCP client follows.
  const rows: { provider: Provider; connection: AiConnectionView | null }[] = [
    ...KNOWN_PROVIDERS.map((provider) => ({
      provider,
      connection: connections.find((c) => c.clientLabel === provider.label) ?? null,
    })),
    ...connections
      .filter((c) => !KNOWN_PROVIDERS.some((p) => p.label === c.clientLabel))
      .map((c) => ({ provider: { label: c.clientLabel, logo: null }, connection: c })),
  ]

  return (
    // Spans both grid columns from tablet up (Calendar and Drive share the row
    // above), so the card stays short; one column on mobile.
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

      <ul className='divide-y divide-gray-100 rounded-md border border-gray-100'>
        {rows.map(({ provider, connection }) => (
          <li key={provider.label} className='flex flex-col gap-2 px-4 py-3'>
            <div className='flex items-center gap-3'>
              <ProviderLogo src={provider.logo} />
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-medium text-gray-800'>{provider.label}</p>
                {connection ? (
                  <div className='flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500'>
                    <span className='inline-flex items-center gap-1 font-medium text-green-700'>
                      <Icon name='check' type='reg' className='size-3 bg-green-600' />
                      מחובר
                    </span>
                    <span>· מאז {connection.connectedOn}</span>
                    <span>· שימוש אחרון {connection.lastUsedOn ?? '—'}</span>
                  </div>
                ) : (
                  <div className='text-xs text-gray-500'>
                    <span className='text-gray-400'>לא מחובר עדיין</span> · החיבור מתחיל מתוך {provider.label}
                  </div>
                )}
              </div>
              {connection ? (
                <Btn lbl={`נתק את ${provider.label}`} variant='outline' onClick={() => setPending(connection)} />
              ) : (
                <Btn lbl='הוראות חיבור' variant='outline' size='small' aria-controls={HOWTO_ID} onClick={openHowTo} />
              )}
            </div>
            {connection && connection.scopeLabels.length > 0 && (
              <ul className='list-disc ps-[3.25rem] text-xs text-gray-600'>
                {connection.scopeLabels.map((label) => (
                  <li key={label} className='desktop:whitespace-nowrap'>
                    {label}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <HowToConnect mcpUrl={mcpUrl} detailsRef={howToRef} />

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
