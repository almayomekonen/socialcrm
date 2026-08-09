'use client'
import { useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { Btn } from '@/lib/btns/Btn'
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS, type BillingPeriod } from '@/lib/pricing'
import { packages, type Pkg } from '@/lib/plans'

/**
 * In-app pricing surface shown under settings/update_payment.
 *
 * Reflects the binary monetization model: Free (everything in the CRM works,
 * with a small AI taste) vs. Pro (the AI brain). Workspace-priced — no
 * per-seat math, no enterprise tier on this surface.
 *
 * `annualAvailable` is server-derived from isAnnualLinkConfigured(): when the
 * annual Grow link is not configured, the Pro card preserves today's UX
 * (monthly price + display-only annual messaging) and the CTA can only ever
 * produce a monthly upgrade.
 */

type PackagesProps = { plan?: string; annualAvailable?: boolean; trialActive?: boolean }

export default function Packages({ plan = 'free', annualAvailable = false, trialActive = false }: PackagesProps) {
  return (
    <div className='my-6 grid md:grid-cols-2 gap-6 max-w-3xl'>
      {packages.map((pkg) => (
        <PackageCard key={pkg.id} pkg={pkg} currentPlan={plan} annualAvailable={annualAvailable} trialActive={trialActive} />
      ))}
    </div>
  )
}

function PackageCard({
  pkg,
  currentPlan,
  annualAvailable,
  trialActive,
}: {
  pkg: Pkg
  currentPlan: string
  annualAvailable: boolean
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

  // Annual is the recommended option — it opens selected. Only meaningful
  // when the selector renders (annualAvailable && isProCard).
  const [period, setPeriod] = useState<BillingPeriod>('annual')
  const selectable = isProCard && annualAvailable && !isThisPlan
  const effectivePeriod: BillingPeriod = selectable ? period : 'monthly'

  const headlinePrice = effectivePeriod === 'annual' ? PRICING.annual : pkg.pricePerMonth
  const headlineSuffix = effectivePeriod === 'annual' ? ' / לשנה' : ' / לחודש'

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

        {selectable ? (
          <div role='radiogroup' aria-label='בחירת מסלול חיוב' className='mt-3 flex flex-col gap-2'>
            <PeriodOption
              selected={period === 'annual'}
              onSelect={() => setPeriod('annual')}
              recommended
              title={`₪${PRICING.annual} / לשנה`}
              subtitle={`₪${ANNUAL_MONTHLY_EQUIVALENT} לחודש בלבד · חיסכון ₪${ANNUAL_SAVINGS} בשנה`}
            />
            <PeriodOption
              selected={period === 'monthly'}
              onSelect={() => setPeriod('monthly')}
              title={`₪${PRICING.monthly} / לחודש`}
              subtitle='ללא התחייבות, ניתן לבטל בכל רגע'
            />
          </div>
        ) : (
          isProCard && (
            // Annual link not configured (or card is the active plan):
            // today's display-only annual messaging, unchanged.
            <div className='mt-3 rounded-lg border border-white/15 bg-white/5 px-3 py-2'>
              <p className='text-sm font-semibold text-white'>
                מסלול שנתי: ₪{PRICING.annual} / לשנה{' '}
                <span className='text-white/60 font-normal'>· ₪{ANNUAL_MONTHLY_EQUIVALENT} לחודש בלבד</span>
              </p>
              <p className='text-[11px] text-white/50 mt-0.5'>חיסכון של ₪{ANNUAL_SAVINGS} בשנה לעומת חיוב חודשי</p>
            </div>
          )
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
            lbl={!selectable ? 'שדרג ל-Pro' : effectivePeriod === 'annual' ? 'שדרג ל-Pro — מסלול שנתי' : 'שדרג ל-Pro — מסלול חודשי'}
            className='w-full bg-white text-gray-900 hover:bg-gray-100'
            onClick={() => {
              window.location.href = `/api/payments/upgrade?period=${effectivePeriod}&source=billing_packages`
            }}
          />
        ) : null}
      </div>
    </fieldset>
  )
}

function PeriodOption({
  selected,
  onSelect,
  title,
  subtitle,
  recommended = false,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  subtitle: string
  recommended?: boolean
}) {
  return (
    <button
      type='button'
      role='radio'
      aria-checked={selected}
      onClick={onSelect}
      className={twMerge(
        'w-full text-start rounded-lg border px-3 py-2 transition-colors',
        selected ? 'border-white bg-white/10' : 'border-white/15 bg-white/5 hover:border-white/40',
      )}
    >
      <span className='flex items-center gap-2'>
        <span
          aria-hidden='true'
          className={twMerge(
            'flex size-4 items-center justify-center rounded-full border flex-none',
            selected ? 'border-white' : 'border-white/40',
          )}
        >
          {selected && <span className='size-2 rounded-full bg-white' />}
        </span>
        <span className='text-sm font-semibold text-white'>{title}</span>
        {recommended && (
          <span className='rounded-full bg-white text-gray-900 px-2 py-0.5 text-[10px] font-bold'>מומלץ</span>
        )}
      </span>
      <span className='block text-[11px] text-white/60 mt-0.5 pr-6'>{subtitle}</span>
    </button>
  )
}
