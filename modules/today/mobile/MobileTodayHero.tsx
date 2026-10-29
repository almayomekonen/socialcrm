import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import type { UiLocale } from '@/lib/i18n/config'
import { dirFor } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import LeadContactActions from '@/modules/leads/mobile/LeadContactActions'
import type { MobileTodayRow, MobileTodayTones } from './viewModel'
import { todayReasonTone, todayToneClass, todayWindowHintTone } from './reasonTone'

/**
 * "התחל כאן" — the one lead the rep should touch first, and the one loud action
 * on the mobile Today.
 *
 * There is exactly ONE of these per screen (ux-guidelines.md §5). Everything
 * below it is a quiet list row. The hero is the same pick the desktop dashboard
 * makes — `pickTopRecommended` decided it, and its Hebrew `reason` string came
 * with it — so a rep who checks their phone and then their laptop is told to
 * call the same person for the same stated reason.
 *
 * Server Component: no clock, no state, no hydration cost. The contact cluster
 * below is the one Client Component on the card, and `tel:` inside it stays a
 * real anchor because dialling is an OS navigation, not an app action.
 */
export default function MobileTodayHero({
  row,
  tones,
  remaining,
  whatsappConnected,
  locale = 'he',
}: {
  row: MobileTodayRow
  /** Resolved from codes on the server (`MobileTodayModel.tones`). */
  tones?: MobileTodayTones
  remaining?: number
  locale?: UiLocale
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
}) {
  const { id, name, phone, reason, href, eyebrow, windowHint } = row
  // Production models carry tones resolved from codes on the server; only a
  // hand-built row without them falls back to the legacy Hebrew-text mapping.
  const t = translatorFor(locale)
  const reasonTone = todayToneClass(tones ? tones.tone : todayReasonTone(reason))
  const hintTone = windowHint ? todayToneClass(tones ? tones.windowTone : todayWindowHintTone(windowHint)) : null
  const summary = remaining && remaining > 0 ? t('today.mobile.remaining', { count: remaining }) : ''

  return (
    <section aria-labelledby='mobile-today-hero' className='rounded-xl border border-gray-200 bg-white p-3.5'>
      <p id='mobile-today-hero' className='text-sm font-semibold text-primary-text'>
        {eyebrow || t('today.eyebrow.startHere')}
        {summary ? <span className='font-medium text-gray-500'>{` · ${summary}`}</span> : null}
      </p>

      <Link
        href={href as Route}
        className='mt-1.5 block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <span className='block truncate text-xl font-bold leading-tight text-ink'>{name || '—'}</span>
        <span className={`mt-0.5 block truncate text-sm ${reasonTone ? `font-medium ${reasonTone.text}` : 'text-gray-600'}`}>
          {reason}
        </span>
        {windowHint && (
          <span className={`mt-0.5 block truncate text-sm ${hintTone ? `font-medium ${hintTone.text}` : 'text-gray-500'}`}>
            {windowHint}
          </span>
        )}
      </Link>

      <div className='mt-3 flex items-center gap-2'>
        {phone ? (
          <LeadContactActions leadId={id} phone={phone} name={name} size='bar' className='min-w-0 flex-1'  whatsappConnected={whatsappConnected} />
        ) : (
          <Link
            href={href as Route}
            className='press flex h-11 flex-1 items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            {t('today.mobile.openLead')}
          </Link>
        )}

        <Link
          href={href as Route}
          aria-label={name ? t('today.mobile.openName', { name }) : t('today.mobile.openLead')}
          className='press flex h-11 shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          <span className='text-[13px] font-medium text-gray-700'>{t('today.mobile.open')}</span>
          {/* Points forward: left in RTL, right in LTR. */}
          <Icon name='angle-left' type='sol' className='size-3.5 bg-gray-600' flip={dirFor(locale) === 'ltr'} />
        </Link>
      </div>
    </section>
  )
}
