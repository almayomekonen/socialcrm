import Link from 'next/link'
import Icon from '@/lib/Icon'
import { cn } from '@/lib/utils'
import type { BriefItem } from '@/lib/today/types'
import { WAIT_STATE_TONE } from './waitTone'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card, CardAction, CardDescription, CardFooter, CardHeader } from '@/components/home/dashboard/card'
import { badgeOutline, btn, sectionCard, toneIcon } from '@/components/home/dashboard/ui'

// Presentational (RSC). The single next action. Today is a pointer: the primary
// act is a plain tel: link (no client JS) and a link to the lead workspace where
// outcomes are logged; the brief refreshes server-side on return.
//
// shadcn dashboard-01 section card: "next mission" as the description, the lead's
// name as the title, the source as an outline badge; the footer holds the wait
// state (bold, with a toned icon), the details (muted) and the two actions.
export default function BriefMission({ item, locale = 'he' }: { item: BriefItem; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const href = item.href ?? `/clients/${item.id}/summary`
  const openConversation = Boolean(item.conversationId || item.href?.startsWith('/inbox'))
  const status = item.waitingFor ?? item.reason
  const tone = WAIT_STATE_TONE[item.state]
  const details = [item.waitingFor ? item.reason : null, item.windowHint, !openConversation ? item.phone : null].filter(Boolean)
  const primary = `${btn.base} ${btn.default} ${btn.sm} flex-1`
  const secondary = `${btn.base} ${btn.outline} ${btn.sm}`

  return (
    <Card className={cn('@container/card justify-between', sectionCard)}>
      <CardHeader>
        <CardDescription className='flex items-center gap-1.5'>
          <Icon name='bolt' className='size-3.5 shrink-0 bg-gray-500' />
          {t('today.mission.title')}
        </CardDescription>
        <Link
          href={href}
          data-slot='card-title'
          className='truncate text-2xl font-semibold text-ink outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-primary/25 @[250px]/card:text-3xl'
        >
          {item.name || '—'}
        </Link>
        {item.source && (
          <CardAction>
            <span className={badgeOutline}>{item.source}</span>
          </CardAction>
        )}
      </CardHeader>
      <CardFooter className='flex-col items-stretch gap-1.5 text-sm'>
        <div className='flex items-center gap-2 font-medium'>
          <span data-tone={tone} className='tabular-nums'>
            {status}
          </span>
          <Icon name='clock' className={`size-4 shrink-0 ${toneIcon[tone]}`} />
        </div>
        {details.length > 0 && <div className='text-gray-500 tabular-nums'>{details.join(' · ')}</div>}
        <div className='mt-3 flex gap-2'>
          {openConversation ? (
            <>
              <Link href={href} className={primary}>
                <Icon name='whatsapp' type='sol' className='size-4 shrink-0 bg-surface' />
                {t('today.mission.openConversation')}
              </Link>
              {item.phone && (
                <a
                  href={`tel:${item.phone}`}
                  aria-label={t('today.mission.callName', { name: item.name || t('today.mission.leadFallback') })}
                  className={`${btn.base} ${btn.outline} ${btn.icon}`}
                >
                  <Icon name='phone' className='size-4 shrink-0 bg-ink' />
                </a>
              )}
            </>
          ) : (
            <>
              {item.phone && (
                <a href={`tel:${item.phone}`} className={primary}>
                  <Icon name='phone' className='size-4 shrink-0 bg-surface' />
                  {t('today.mission.call')}
                </a>
              )}
              <Link href={href} className={item.phone ? secondary : primary}>
                {t('today.mission.openLead')}
              </Link>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}
