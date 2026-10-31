'use client'

import { Check } from 'lucide-react'
import { Btn } from '@/lib/btns/Btn'
import { PRICING } from '@/lib/pricing'
import LeadEntryToasts from './LeadEntryToasts'
import CardTrialSetupForm from './CardTrialSetupForm'
import { upgradeHref } from '@/lib/entitlement/upgradeHref'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'
import { rtlOrRegionAttrs } from '@/lib/i18n/preLoginLocale'
import type { MessageKey } from '@/lib/i18n/translate'

/** The benefit lines, by catalog key (`trial.expired.benefits.*`). */
const PRO_BENEFITS: MessageKey[] = ['trial.expired.benefits.ai', 'trial.expired.benefits.history', 'trial.expired.benefits.drafting']

export type CardReactivationReason = 'declined' | 'cancelled' | 'ended'

type Props = {
  leadCount?: number
  leadNames?: string[]
  /**
   * Card-token agency: recovery is updating the card and continuing, not a
   * Payment Link (which would open a second Grow standing order).
   */
  cardReactivation?: { reason: CardReactivationReason }
}

/** The paywall's sentence for a card-token agency, by reason (`trial.expired.reactivation.*`). */
const REACTIVATION_BODY: Record<CardReactivationReason, MessageKey> = {
  declined: 'trial.expired.reactivation.declined',
  cancelled: 'trial.expired.reactivation.cancelled',
  ended: 'trial.expired.reactivation.ended',
}

export default function TrialExpiredScreen({ leadCount = 0, leadNames = [], cardReactivation }: Props) {
  const hasLeads = leadCount > 0
  const t = useT()
  // The count's digits as Hebrew printed them (no grouping); bolded where the sentence places it.
  const count = String(leadCount)
  const waiting = t('trial.expired.waiting', { count })
  const at = waiting.indexOf(count)

  return (
    <div className='fixed inset-0 z-99999 flex items-center justify-center p-4 bg-gray-950/20 backdrop-blur-[2px] anim-fade-in'>
      {/* Live lead toasts over the blurred dashboard, behind the card. */}
      <LeadEntryToasts names={leadNames} />

      <div
        {...rtlOrRegionAttrs(t.locale)}
        className='relative z-10 flex flex-col gap-6 w-full max-w-[440px] bg-gray-900 rounded-2xl p-8 shadow-2xl shadow-gray-900/40'
      >
        <div>
          <span className='inline-block text-xs font-bold px-3 py-1 bg-white text-gray-900 rounded-full'>Pro</span>
          <h1 className='text-2xl font-bold leading-snug text-white mt-4'>
            {hasLeads ? t('trial.expired.titleLeads') : t('trial.expired.title')}
          </h1>
          <p className='text-sm text-white/70 mt-2 leading-relaxed'>
            {cardReactivation ? t(REACTIVATION_BODY[cardReactivation.reason]) : t('trial.expired.body')}
          </p>
          {hasLeads && (
            <p className='text-sm text-white/80 mt-3'>
              {at < 0 ? (
                waiting
              ) : (
                <>
                  {waiting.slice(0, at)}
                  <span className='font-bold text-white'>{count}</span>
                  {waiting.slice(at + count.length)}
                </>
              )}
            </p>
          )}
        </div>

        <div>
          <p className='text-4xl font-extrabold text-white'>
            ₪{PRICING.monthly}
            <span className={`text-base font-normal text-white/50 ${dirFor(t.locale) === 'ltr' ? 'ml-1' : 'mr-1'}`}>{t('trial.expired.perMonth')}</span>
          </p>
          {/* Monthly only, in every path. Card-token billing is the only way to
              pay in this release, so an annual price on the screen that exists
              to take payment would advertise something nobody can buy. */}
        </div>

        <ul className='list-none space-y-2.5'>
          {PRO_BENEFITS.map((benefit) => (
            <li key={benefit} className='flex items-start gap-3'>
              <Check className='h-4 w-4 shrink-0 mt-0.5 text-white' aria-hidden='true' />
              <span className='text-sm text-white/90'>{t(benefit)}</span>
            </li>
          ))}
        </ul>

        {cardReactivation ? (
          <div className='rounded-xl bg-white p-4'>
            <CardTrialSetupForm purpose='reactivate' submitLabel={t('trial.expired.updateCard')} translated />
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            <Btn
              variant='solid'
              size='large'
              lbl={t('trial.expired.upgrade')}
              className='w-full bg-white text-gray-900 font-bold hover:bg-gray-100'
              onClick={() => {
                window.location.href = upgradeHref('trial_expired_screen')
              }}
            />
            <p className='text-[11px] text-white/40 text-center'>{t('trial.expired.note')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
