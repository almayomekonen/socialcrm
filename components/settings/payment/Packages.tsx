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
 * thing, ₪89 a month on a saved card. The card itself is added in the
 * `#card-setup` section of the billing page, so the Pro CTA scrolls there
 * rather than opening a checkout.
 */

type PackagesProps = { plan?: string; trialActive?: boolean }

export default function Packages({ plan = 'free', trialActive = false }: PackagesProps) {
  return (
    <div className='my-6 grid md:grid-cols-2 gap-6 max-w-3xl'>
      {packages.map((pkg) => (
        <PackageCard key={pkg.id} pkg={pkg} currentPlan={plan} trialActive={trialActive} />
      ))}
    </div>
  )
}

function PackageCard({
  pkg,
  currentPlan,
  trialActive,
}: {
  pkg: Pkg
  currentPlan: string
  trialActive: boolean
}) {
  const isProPlan = currentPlan === 'pro'
  const isProCard = pkg.id === 'pro'
  // During an active Pro trial the user is on Pro-by-trial: the Pro card wears a
  // trial badge and NO card is the "current paid plan" (so Free is never marked
  // current). trialActive is only ever true while plan is still 'free', so the
  // paid state below (isProPlan) is unaffected.
  const proTrialBadge = trialActive && isProCard
  const isThisPlan = !trialActive && ((pkg.id === 'pro' && isProPlan) || (pkg.id === 'free' && !isProPlan))

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
        ) : isProCard ? (
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

