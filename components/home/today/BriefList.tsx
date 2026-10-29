import Link from 'next/link'
import Icon from '@/lib/Icon'
import LeadAvatar from '@/components/ui/lead-avatar'
import type { BriefItem } from '@/lib/today/types'
import { WAIT_TONE } from './waitTone'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// Presentational (RSC). The rest of the brief — dense rows, no pagination
// (INV-15). The wait chip's tone is chosen from the precomputed state and it
// always carries text (never color-only).
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const iconBtn = `inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface transition-colors ${focusRing}`

export default function BriefList({ items, locale = 'he' }: { items: BriefItem[]; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <section className='min-w-0 flex-[2_1_560px] overflow-hidden rounded-2xl border border-border bg-surface'>
      <div className='flex items-center justify-between gap-3 px-[22px] pt-[18px] pb-3'>
        <div className='flex items-center gap-2.5'>
          <h2 className='text-lg font-bold text-ink'>{t('today.list.title')}</h2>
          <span className='rounded-[10px] bg-error-bg px-2 py-0.5 text-xs font-bold text-error-text tabular-nums'>
            {items.length}
          </span>
        </div>
        <Link href='/leads' className={`text-sm font-semibold text-primary-text hover:text-primary ${focusRing}`}>
          {t('today.list.allLeads')}
        </Link>
      </div>
      <ul>
        {items.map((it) => {
          const href = it.href ?? `/clients/${it.id}/summary`
          const chip = it.waitingFor ?? it.reason
          // Same rule as the mission card: only a real thread link earns the WhatsApp action.
          const openConversation = Boolean(it.conversationId || it.href?.startsWith('/inbox'))
          return (
            <li
              key={it.id}
              className='flex items-center gap-3.5 border-t border-gray-100 px-[22px] py-3 transition-colors hover:bg-bg'
            >
              <LeadAvatar name={it.name} size='md' fallback={t('today.list.avatarFallback')} />
              <div className='min-w-0 flex-1'>
                <Link
                  href={href}
                  className={`block truncate text-[15px] font-semibold text-ink hover:underline ${focusRing}`}
                >
                  {it.name || '—'}
                </Link>
                <p className='truncate text-[13px] text-gray-500'>
                  {it.waitingFor ? it.reason : ''}
                  {it.waitingFor && it.windowHint ? ' · ' : ''}
                  {it.windowHint ?? ''}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-lg px-2 py-[3px] text-xs font-bold whitespace-nowrap tabular-nums ${WAIT_TONE[it.state]}`}
              >
                {chip}
              </span>
              {it.source && (
                <span className='hidden max-w-28 shrink-0 truncate rounded-lg bg-neutral-bg px-2 py-[3px] text-xs text-neutral-text sm:inline'>
                  {it.source}
                </span>
              )}
              <div className='flex shrink-0 gap-1.5'>
                {openConversation && (
                  <Link
                    href={href}
                    aria-label={t('today.list.whatsappWith', { name: it.name || t('today.mission.leadFallback') })}
                    className={`${iconBtn} hover:border-success-border hover:bg-success-bg`}
                  >
                    <Icon name='whatsapp' type='sol' className='size-[17px] bg-success' />
                  </Link>
                )}
                {it.phone && (
                  <a
                    href={`tel:${it.phone}`}
                    aria-label={t('today.mission.callName', { name: it.name || t('today.mission.leadFallback') })}
                    className={`group ${iconBtn} hover:bg-primary-tint`}
                  >
                    <Icon name='phone' className='size-4 bg-ink group-hover:bg-primary-text' />
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
