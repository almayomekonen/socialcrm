import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { BriefItem } from '@/lib/today/types'
import { WAIT_TONE } from './waitTone'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// Presentational (RSC). The single next action — the eye magnet. Today is a
// pointer: the primary act is a plain tel: link (no client JS) and a link to the
// lead workspace where outcomes are logged; the brief refreshes server-side on return.
// A white card on brand tokens: tinted header band, primary accent edge on the
// start side, one solid primary action.
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const primaryBtn = `inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-[15px] font-semibold whitespace-nowrap text-white transition-colors hover:bg-primary-text ${focusRing}`
const secondaryBtn = `inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-border bg-surface px-4 text-[15px] font-semibold whitespace-nowrap text-ink transition-colors hover:border-primary hover:text-primary-text ${focusRing}`

export default function BriefMission({ item, locale = 'he' }: { item: BriefItem; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const href = item.href ?? `/clients/${item.id}/summary`
  const openConversation = Boolean(item.conversationId || item.href?.startsWith('/inbox'))
  const status = item.waitingFor ?? item.reason
  const details = [item.waitingFor ? item.reason : null, item.windowHint, !openConversation ? item.phone : null].filter(Boolean)

  return (
    <section className='relative flex min-w-0 flex-[1_1_340px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-overlay'>
      <span aria-hidden className='absolute inset-y-0 start-0 w-1 bg-primary' />
      <div className='flex items-center justify-between gap-3 bg-primary-tint px-6 py-3'>
        <span className='flex items-center gap-2 text-sm font-semibold text-primary-text'>
          <Icon name='bolt' className='size-4 bg-primary-text' />
          {t('today.mission.title')}
        </span>
        {item.source && <span className='truncate text-xs font-semibold text-primary-text/80'>{item.source}</span>}
      </div>

      <div className='flex flex-1 flex-col justify-between gap-4 px-6 pt-4 pb-5'>
        <div className='min-w-0'>
          <Link href={href} className={`block truncate text-[26px] leading-tight font-bold text-ink hover:underline ${focusRing}`}>
            {item.name || '—'}
          </Link>
          <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5'>
            <span className={`rounded-lg px-2 py-[3px] text-xs font-bold whitespace-nowrap tabular-nums ${WAIT_TONE[item.state]}`}>
              {status}
            </span>
            {details.length > 0 && <span className='text-sm text-gray-500 tabular-nums'>{details.join(' · ')}</span>}
          </div>
        </div>

        <div className='flex gap-2'>
          {openConversation ? (
            <>
              <Link href={href} className={primaryBtn}>
                <Icon name='whatsapp' type='sol' className='size-4 bg-white' />
                {t('today.mission.openConversation')}
              </Link>
              {item.phone && (
                <a href={`tel:${item.phone}`} aria-label={t('today.mission.callName', { name: item.name || t('today.mission.leadFallback') })} className={`group ${secondaryBtn} w-11 shrink-0 px-0`}>
                  <Icon name='phone' className='size-[18px] bg-ink group-hover:bg-primary-text' />
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
        </div>
      </div>
    </section>
  )
}
