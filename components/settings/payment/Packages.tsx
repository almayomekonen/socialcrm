'use client'
import { twMerge } from 'tailwind-merge'
import { Btn } from '@/lib/btns/Btn'
import { packages, type Pkg } from '@/lib/plans'

/**
 * In-app pricing surface shown under settings/update_payment.
 *
 * Reflects the binary monetization model: Free (everything in the CRM works,
 * with a small AI taste) vs. Pro (the AI brain). Workspace-priced — no
 * per-seat math, no enterprise tier on this surface.
 *
 * Annual purchasing was removed with Payment Links: this release sells one
 * thing, ₪89 a month on a saved card. The card is added in the `#card-setup`
 * section of the billing page, so the Pro CTA scrolls there rather than opening
 * a checkout — but ONLY when that section exists.
 *
 * THE DEAD CONTROL THIS FIXES. #card-setup is rendered only when no card is
 * billed. An account that already has a verified card therefore scrolled to an
 * element that was not in the DOM: getElementById returned null, the optional
 * chain swallowed it, and the button did nothing at all — no action, no
 * navigation, no feedback. Production agency 157 hit exactly that, mid-trial
 * with a saved card and renewal cancelled.
 *
 * The fix is not a second resume path. Resuming a cancelled subscription is
 * owned by CardBillingControls, which routes through resumeRenewal and its
 * isCardResumeBlocked guard — the guard that stops a resume after access has
 * ended from being charged immediately without warning. Duplicating that here
 * would bypass it, so when a card exists this surface offers no action and
 * defers to the card section above it.
 */

type PackagesProps = { plan?: string; trialActive?: boolean; cardBilled?: boolean }

export default function Packages({ plan = 'free', trialActive = false, cardBilled = false }: PackagesProps) {
  return (
    <div className='my-6 grid gap-6 max-w-md'>
      {packages.map((pkg) => (
        <PackageCard key={pkg.id} pkg={pkg} currentPlan={plan} trialActive={trialActive} cardBilled={cardBilled} />
      ))}
      {/* Stated only where it is true. A LEGACY (trialExempt) agency is also
          plan 'free' and reaches this surface, and has no trial to end. */}
      {trialActive && (
        <p className='text-sm text-gray-500'>ללא מנוי פעיל, הגישה למערכת נפסקת בתום תקופת הניסיון.</p>
      )}
    </div>
  )
}

function PackageCard({
  pkg,
  currentPlan,
  trialActive,
  cardBilled,
}: {
  pkg: Pkg
  currentPlan: string
  trialActive: boolean
  cardBilled: boolean
}) {
  const isProPlan = currentPlan === 'pro'
  const isProCard = pkg.id === 'pro'
  // During an active Pro trial the user is on Pro-by-trial: the card wears a
  // trial badge and is not the "current paid plan". trialActive is only ever
  // true while plan is still 'free', so isProPlan below is unaffected.
  const proTrialBadge = trialActive && isProCard
  // Only Pro is offered here now, so the free half of this test is gone with it.
  const isThisPlan = !trialActive && isProPlan

  const headlinePrice = pkg.pricePerMonth
  const headlineSuffix = ' / לחודש'

  return (
    <fieldset
      className={twMerge(
        'p-6 rounded-2xl flex flex-col justify-between transition-colors',
        isProCard ? 'bg-gray-900 text-white border border-gray-900' : 'bg-white border border-gray-200',
      )}
    >
      {isThisPlan && (
        <legend
          className={twMerge(
            'rounded-full px-3 py-0.5 text-xs font-semibold',
            isProCard ? 'bg-white text-gray-900' : 'bg-gray-900 text-white',
          )}
        >
          התוכנית הנוכחית שלך
        </legend>
      )}

      {proTrialBadge && (
        <legend className='rounded-full px-3 py-0.5 text-xs font-semibold bg-white text-gray-900'>
          תקופת הניסיון שלך
        </legend>
      )}

      <div className='space-y-2'>
        <h2 className='text-xl font-bold'>{pkg.name}</h2>
        <p className={twMerge('text-2xl font-extrabold', isProCard ? 'text-white' : 'text-gray-900')}>
          {pkg.pricePerMonth === 0 ? (
            'חינם'
          ) : (
            <>
              ₪{headlinePrice}
              <span className={twMerge('text-sm font-normal', isProCard ? 'text-white/50' : 'text-gray-400')}>
                {headlineSuffix}
              </span>
            </>
          )}
        </p>
        <p className={twMerge('text-sm', isProCard ? 'text-white/70' : 'text-gray-500')}>{pkg.tagline}</p>
        {pkg.pricePerMonth > 0 && (
          <p className={twMerge('text-[11px]', isProCard ? 'text-white/40' : 'text-gray-400')}>
            לסביבת עבודה, כולל את כל הצוות. ניתן לבטל בכל רגע.
          </p>
        )}


        <ul className='mt-4 space-y-2'>
          {pkg.included.map((item) => (
            <li
              key={item}
              className={twMerge('text-sm flex items-start gap-2', isProCard ? 'text-white/90' : 'text-gray-700')}
            >
              <span className={twMerge('shrink-0', isProCard ? 'text-white' : 'text-gray-900')}>✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className='mt-6'>
        {isThisPlan ? (
          <p
            className={twMerge('text-sm font-semibold text-center', isProCard ? 'text-white/80' : 'text-green-700')}
          >
            פעיל
          </p>
        ) : isProCard && !cardBilled ? (
          /* Only rendered when #card-setup exists — the same condition the page
             uses to render it — so this scroll can never be a silent no-op. */
          <Btn
            lbl='שדרג ל-Pro'
            className='w-full bg-white text-gray-900 hover:bg-gray-100'
            onClick={() => {
              document.getElementById('card-setup')?.scrollIntoView({ behavior: 'smooth' })
            }}
          />
        ) : null}
      </div>
    </fieldset>
  )
}

