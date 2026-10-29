/**
 * The plan line on the billing page, and the first-card CTA beside it.
 *
 * Extracted when the CTA was fixed: the page had crossed the file-size soft
 * limit (architecture-rules.md §1), and the box is also the piece a fixture
 * needs to render to show the corrected post-save screen — a screenshot of
 * copied markup would prove nothing about the page.
 *
 * `canAddFirstCard` is the whole point of the fix. It is the VERIFIED CARD
 * state (`cardView.cardBilled`), never the plan: a trialing agency has
 * plan 'free', so gating on the plan offered a first-card button to accounts
 * that had just saved one — and pointed it at #card-setup, a section that is
 * only rendered when no card is billed, so the anchor resolved to nothing.
 */
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default function PlanStatusBox({ trialActive, canAddFirstCard, locale = 'he' }: { trialActive: boolean; canAddFirstCard: boolean; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='mb-6 max-w-3xl p-6 bg-white rounded-lg border border-gray-200 flex items-center justify-between gap-4'>
      <div>
        <p className='text-lg font-semibold'>{trialActive ? t('settings.payment.plan.current') : t('settings.payment.plan.free')}</p>
        <p className='text-sm text-gray-500'>{trialActive ? t('settings.payment.plan.statusActive') : t('settings.payment.plan.statusInactive')}</p>
      </div>
      {canAddFirstCard && (
        <a
          href='#card-setup'
          className='flex items-center min-w-fit justify-center font-medium rounded-md h-10 px-4 bg-solid text-white hover:bg-solid/85'
        >
          {t('settings.payment.plan.addMethod')}
        </a>
      )}
    </div>
  )
}
