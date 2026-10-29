'use client'

import Icon from '@/lib/Icon'
import { upgradeHref } from '@/lib/entitlement/upgradeHref'
import { useEntitlement } from '@/lib/entitlement/EntitlementContext'
import { useT } from '@/lib/i18n/I18nProvider'
import { regionAttrs, untranslatedAttrs } from '@/lib/i18n/config'
import { formatDate } from '@/lib/i18n/format'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'
import { BUSINESS_TZ } from '@/lib/today/constants'

/**
 * ONE expired-subscription surface, in three densities.
 *
 * The forensic audit found six different ways the product currently expresses a
 * single fact — a silent no-op, a raw React #441 dialog, "משהו השתבש, נסה שוב",
 * a permanent "בעיית חיבור — מנסה שוב" retry banner, a false "no notifications"
 * empty state, and a redirect to the marketing homepage. All of them describe a
 * lapsed subscription. This is the one component that says so.
 *
 * WHY THREE MODES INSTEAD OF A MODAL EVERYWHERE. A full-screen blocker is right
 * for a page whose whole purpose is gated, wrong for a disabled button, and
 * hostile inside a panel the user opened deliberately. Same words, same CTA,
 * three densities:
 *
 *   page   a centred state that replaces a route's body, inside the app shell
 *   panel  fills a feature region (the AI panel, a locked composer)
 *   inline a compact strip for banners, dropdowns and result areas
 *
 * NEVER "נסה שוב". A lapsed subscription is not a transient failure and retrying
 * cannot succeed; offering a retry is what made the audit's testers read this as
 * an outage. The only forward action is renewal.
 *
 * THE CTA IS A LINK, NOT AN EFFECT. `/api/payments/upgrade` is the EXISTING
 * upgrade route; it creates the pending-upgrade row and redirects to Grow when
 * VISITED. Rendering this component performs no request and mutates nothing —
 * the write happens on click, which is the requirement that the renewal CTA must
 * not change subscription state merely by being displayed.
 */

export type ExpiredMode = 'page' | 'panel' | 'inline'

/**
 * LANGUAGE. The chrome (title, body, CTA, lapsed date) is in the catalog
 * (`entitlement.*`). The `feature` line is the CALLER's sentence, and most
 * callers sit on screens that are not translated yet and pass Hebrew. Gluing
 * that Hebrew to an English body would produce one mixed sentence, so:
 *
 *   default         the whole state is Hebrew whatever the interface language,
 *                   and its root re-declares Hebrew (`untranslatedAttrs`), so
 *                   it reads correctly even inside a translated region.
 *   `translated`    the caller promises `feature` is already in the interface
 *                   language (`t(...)`); the chrome follows that language and
 *                   the root declares it (`regionAttrs`).
 *
 * For a Hebrew user both are the exact markup this component always rendered.
 */
const HEBREW = translatorFor('he')

/**
 * COPY RULE. No dash is used to join words or clauses, and no capability is
 * described merely as "מושהה". Every string here says what renewing GIVES the
 * customer, because a locked state that only announces a loss gives them
 * nothing to do with the information.
 *
 * Trial-never-started is a different sentence from a lapsed paid plan.
 */
function bodyFor(t: Translator, status: string): string {
  if (status === 'NEVER_STARTED') return t('entitlement.bodyNeverStarted')
  return t('entitlement.bodyLapsed')
}

/** Hebrew keeps its exact legacy date; other languages format in the business timezone. */
function lapsedDate(t: Translator, expiresAt: string): string {
  if (t.locale === 'he') return new Date(expiresAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
  return formatDate(t.locale, expiresAt, BUSINESS_TZ, 'medium')
}


export default function SubscriptionExpiredState({
  mode = 'panel',
  /** Analytics attribution on the existing upgrade route. */
  source = 'entitlement_state',
  /** Optional one-line override naming the specific capability that is paused. */
  feature,
  className = '',
  /** The caller's `feature` is in the interface language; see LANGUAGE above. */
  translated = false,
}: {
  mode?: ExpiredMode
  source?: string
  feature?: string
  className?: string
  translated?: boolean
}) {
  const { status, expiresAt } = useEntitlement()
  const ui = useT()
  const t = translated ? ui : HEBREW
  const region = translated ? regionAttrs(ui.locale) : untranslatedAttrs(ui.locale)
  const title = t('entitlement.title')

  const lapsed = expiresAt ? lapsedDate(t, expiresAt) : null

  const cta = (
    <a
      href={upgradeHref(source)}
      className='press inline-flex min-h-11 items-center justify-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    >
      {t('entitlement.renew')}
    </a>
  )

  if (mode === 'inline') {
    return (
      <div
        data-testid='subscription-expired-inline'
        {...region}
        className={`flex flex-wrap items-center gap-3 rounded-lg border border-warning-border bg-warning-bg px-3.5 py-3 ${className}`}
      >
        <Icon name='lock' type='sol' className='size-4 shrink-0 bg-warning-text' />
        <p className='min-w-0 flex-1 text-[13px] leading-snug text-warning-text'>
          {/*
            One value sentence, never a dash-joined "feature is paused"
            fragment. The `feature` a caller passes IS the sentence, phrased as
            what renewing restores, so it reads on its own beside the CTA.
          */}
          {feature ?? title}
        </p>
        <a
          href={upgradeHref(source)}
          className='shrink-0 text-[13px] font-semibold text-warning-text underline underline-offset-2'
        >
          {t('entitlement.renew')}
        </a>
      </div>
    )
  }

  const pad = mode === 'page' ? 'px-6 py-16' : 'px-6 py-12'

  return (
    <div
      data-testid='subscription-expired-state'
      {...region}
      className={`flex flex-col items-center gap-4 text-center ${pad} ${className}`}
    >
      <span className='flex size-14 items-center justify-center rounded-full bg-gray-100'>
        <Icon name='lock' type='sol' className='size-6 bg-gray-500' />
      </span>

      <div className='max-w-[380px]'>
        <h2 className='text-lg font-bold text-ink'>{title}</h2>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>{feature ? `${feature} ${bodyFor(t, status)}` : bodyFor(t, status)}</p>
        {lapsed && <p className='mt-1.5 text-[13px] text-gray-400'>{t('entitlement.lapsedOn', { date: lapsed })}</p>}
      </div>

      {cta}
    </div>
  )
}
