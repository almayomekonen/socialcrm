import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { BriefItem } from '@/lib/today/types'
import type { Tone } from '@/components/home/dashboard/ui'
import { WAIT_STATE_TONE } from './waitTone'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'
import { Card } from '@/components/home/dashboard/card'

// Presentational (RSC). The single next action. Today is a pointer: the primary
// act is a plain tel: link or the conversation (no client JS); outcomes are logged
// in the lead workspace and the brief refreshes server-side on return.
//
// Layout (owner mockup 2026-11-07): title + wait pill; the lead (initial tile, name,
// source, details); a "recommended action" box; one full-width primary action and
// the secondary actions as quiet links underneath.
//
// The recommendation is fixed copy chosen by the server-decided state — guidance,
// never a fact about the lead (care-charter Law 1).
const PILL: Record<Tone, string> = {
  bad: 'bg-error-bg text-error-text',
  warn: 'bg-warning-bg text-warning-text',
  good: 'bg-success-bg text-success-text',
  info: 'bg-primary-tint text-primary-text',
}
const PILL_ICON: Record<Tone, string> = { bad: 'bg-error-text', warn: 'bg-warning-text', good: 'bg-success-text', info: 'bg-primary-text' }

const focus = 'outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25'
const primaryBtn = `inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-b from-primary to-primary-text px-5 text-[15px] font-semibold text-white shadow-[0_6px_16px_-6px_rgb(94_106_210/0.6)] transition-opacity hover:opacity-95 ${focus}`
const quietLink = `inline-flex items-center gap-1.5 rounded-md px-1 text-sm font-medium text-gray-600 hover:text-primary-text ${focus}`

export default function BriefMission({ item, locale = 'he' }: { item: BriefItem; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const href = item.href ?? `/clients/${item.id}/summary`
  const leadHref = `/clients/${item.id}/summary`
  const openConversation = Boolean(item.conversationId || item.href?.startsWith('/inbox'))
  const status = item.waitingFor ?? item.reason
  const tone = WAIT_STATE_TONE[item.state]
  const details = [item.waitingFor ? item.reason : null, item.windowHint, !openConversation ? item.phone : null].filter(Boolean)
  const initial = (item.name || t('today.list.avatarFallback')).trim().charAt(0).toUpperCase()
  const callLabel = t('today.mission.callName', { name: item.name || t('today.mission.leadFallback') })

  return (
    <Card className='gap-0 rounded-2xl px-6 py-6 shadow-[0_8px_30px_-12px_rgb(94_106_210/0.25)]'>
      {/* Title + wait pill. */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <Icon name='bolt' className='size-5 shrink-0 bg-primary' />
          <h2 className='text-lg font-bold text-ink'>{t('today.mission.title')}</h2>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums ${PILL[tone]}`}>
          <Icon name='clock' className={`size-4 shrink-0 ${PILL_ICON[tone]}`} />
          <span data-tone={tone}>{status}</span>
        </span>
      </div>

      {/* The lead. */}
      <div className='mt-5 flex items-center gap-4 border-t border-border pt-5'>
        <span aria-hidden className='flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-2xl font-bold text-primary'>
          {initial}
        </span>
        <div className='min-w-0 flex-1'>
          <Link href={href} className={`block truncate text-xl font-bold text-ink hover:text-primary-text hover:underline ${focus}`}>
            {item.name || '—'}
          </Link>
          {item.source && <p className='mt-0.5 truncate text-sm text-gray-500'>{item.source}</p>}
          {details.length > 0 && <p className='mt-0.5 truncate text-sm text-gray-500 tabular-nums'>{details.join(' · ')}</p>}
        </div>
        {openConversation && <Icon name='whatsapp' type='sol' className='size-9 shrink-0 bg-success' />}
      </div>

      {/* Recommended action — fixed copy per state. */}
      <div className='mt-4 rounded-xl bg-primary-tint/70 px-4 py-3'>
        <p className='flex items-center gap-1.5 text-sm font-semibold text-primary-text'>
          <Icon name='sparkles' className='size-4 shrink-0 bg-primary' />
          {t('today.mission.recommended')}
        </p>
        <p className='mt-1 text-sm text-ink'>{t(`today.mission.suggest.${item.state}` as MessageKey)}</p>
      </div>

      {/* One primary action; the rest as quiet links. */}
      <div className='mt-auto flex flex-col items-center gap-3 pt-4'>
        {openConversation ? (
          <Link href={href} className={primaryBtn}>
            <Icon name='whatsapp' type='sol' className='size-5 shrink-0 bg-white' />
            {t('today.mission.openConversation')}
          </Link>
        ) : item.phone ? (
          <a href={`tel:${item.phone}`} className={primaryBtn}>
            <Icon name='phone' className='size-5 shrink-0 bg-white' />
            {t('today.mission.call')}
          </a>
        ) : (
          <Link href={leadHref} className={primaryBtn}>
            {t('today.mission.openLead')}
          </Link>
        )}

        {(openConversation || item.phone) && (
          <div className='flex items-center gap-3'>
            {openConversation && item.phone && (
              <>
                <a href={`tel:${item.phone}`} aria-label={callLabel} className={quietLink}>
                  <Icon name='phone' className='size-4 shrink-0 bg-gray-600' />
                  {t('today.mission.call')}
                </a>
                <span aria-hidden className='text-gray-300'>
                  ·
                </span>
              </>
            )}
            <Link href={leadHref} className={quietLink}>
              <Icon name='user' className='size-4 shrink-0 bg-gray-600' />
              {t('today.mission.openLead')}
            </Link>
          </div>
        )}
      </div>
    </Card>
  )
}
