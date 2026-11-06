import Link from 'next/link'
import Icon from '@/lib/Icon'
import LeadAvatar from '@/components/ui/lead-avatar'
import type { BriefItem } from '@/lib/today/types'
import { WAIT_TONE } from './waitTone'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/home/dashboard/card'

// Presentational (RSC). The single next action — the eye magnet. Today is a
// pointer: the primary act is a plain tel: link (no client JS) and a link to the
// lead workspace where outcomes are logged; the brief refreshes server-side on return.
//
// shadcn card: "next mission" eyebrow + source badge in the header, the lead
// (avatar, name, wait badge, details) in the content, one solid primary action
// and one outline action in the footer.
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const primaryBtn = `inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold whitespace-nowrap text-white shadow-[0_1px_2px_rgb(15_23_42/0.12)] transition-colors hover:bg-primary-text ${focusRing}`
const secondaryBtn = `inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold whitespace-nowrap text-ink shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-colors hover:border-primary hover:text-primary-text ${focusRing}`

export default function BriefMission({ item, locale = 'he' }: { item: BriefItem; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const href = item.href ?? `/clients/${item.id}/summary`
  const openConversation = Boolean(item.conversationId || item.href?.startsWith('/inbox'))
  const status = item.waitingFor ?? item.reason
  const details = [item.waitingFor ? item.reason : null, item.windowHint, !openConversation ? item.phone : null].filter(Boolean)

  return (
    <Card className='flex-[1_1_360px] justify-between gap-5 border-primary/25 bg-linear-to-b from-primary-tint/70 to-surface pb-0 shadow-overlay'>
      <CardHeader>
        <CardDescription className='flex items-center gap-1.5 font-semibold text-primary-text'>
          <span className='inline-flex size-6 items-center justify-center rounded-md bg-primary'>
            <Icon name='bolt' className='size-3.5 bg-white' />
          </span>
          {t('today.mission.title')}
        </CardDescription>
        {item.source && (
          <CardAction>
            <span className='inline-flex max-w-36 truncate rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-gray-600'>
              {item.source}
            </span>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className='flex items-center gap-4'>
        <LeadAvatar name={item.name} size='lg' fallback={t('today.list.avatarFallback')} />
        <div className='min-w-0 flex-1'>
          <Link href={href} className={`block truncate text-[22px] leading-tight font-bold text-ink hover:underline ${focusRing}`}>
            {item.name || '—'}
          </Link>
          <div className='mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1'>
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums ${WAIT_TONE[item.state]}`}>
              {status}
            </span>
            {details.length > 0 && <span className='text-sm text-gray-500 tabular-nums'>{details.join(' · ')}</span>}
          </div>
        </div>
      </CardContent>

      <CardFooter className='gap-2 border-t border-border bg-surface/70 py-4'>
        {openConversation ? (
          <>
            <Link href={href} className={primaryBtn}>
              <Icon name='whatsapp' type='sol' className='size-4 bg-white' />
              {t('today.mission.openConversation')}
            </Link>
            {item.phone && (
              <a
                href={`tel:${item.phone}`}
                aria-label={t('today.mission.callName', { name: item.name || t('today.mission.leadFallback') })}
                className={`group ${secondaryBtn} w-10 shrink-0 px-0`}
              >
                <Icon name='phone' className='size-4 bg-ink group-hover:bg-primary-text' />
              </a>
            )}
          </>
        ) : (
          <>
            {item.phone && (
              <a href={`tel:${item.phone}`} className={primaryBtn}>
                <Icon name='phone' className='size-4 bg-white' />
                {t('today.mission.call')}
              </a>
            )}
            <Link href={href} className={item.phone ? secondaryBtn : primaryBtn}>
              {t('today.mission.openLead')}
            </Link>
          </>
        )}
      </CardFooter>
    </Card>
  )
}
