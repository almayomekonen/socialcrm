'use client'
import { twMerge } from 'tailwind-merge'
import { Btn } from '@/lib/btns/Btn'

/**
 * In-app pricing surface shown under settings/update_payment.
 *
 * Reflects the binary monetization model: Free (everything in the CRM works,
 * with a small AI taste) vs. Pro (the AI brain). Workspace-priced — no
 * per-seat math, no enterprise tier on this surface.
 *
 * Pricing UX phase only — the upgrade button hits the existing
 * /api/payments/upgrade route; no entitlement/Stripe wiring is added here.
 */

type PackagesProps = { plan?: string }

export default function Packages({ plan = 'free' }: PackagesProps) {
  return (
    <div className='my-6 grid md:grid-cols-2 gap-6 max-w-3xl'>
      {packages.map((pkg) => (
        <PackageCard key={pkg.id} pkg={pkg} currentPlan={plan} />
      ))}
    </div>
  )
}

type Pkg = {
  id: 'free' | 'pro'
  name: string
  pricePerMonth: number
  tagline: string
  included: string[]
}

function PackageCard({ pkg, currentPlan }: { pkg: Pkg; currentPlan: string }) {
  const isProPlan = currentPlan === 'pro'
  const isThisPlan = (pkg.id === 'pro' && isProPlan) || (pkg.id === 'free' && !isProPlan)
  const isProCard = pkg.id === 'pro'

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

      <div className='space-y-2'>
        <h2 className='text-xl font-bold'>{pkg.name}</h2>
        <p className={twMerge('text-2xl font-extrabold', isProCard ? 'text-white' : 'text-gray-900')}>
          {pkg.pricePerMonth === 0 ? (
            'חינם'
          ) : (
            <>
              ₪{pkg.pricePerMonth}
              <span className={twMerge('text-sm font-normal', isProCard ? 'text-white/50' : 'text-gray-400')}>
                {' '}
                / לחודש
              </span>
            </>
          )}
        </p>
        <p className={twMerge('text-sm', isProCard ? 'text-white/70' : 'text-gray-500')}>{pkg.tagline}</p>
        {pkg.pricePerMonth > 0 && (
          <p className={twMerge('text-[11px]', isProCard ? 'text-white/40' : 'text-gray-400')}>
            לסביבת עבודה, כולל את כל הצוות.
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
              window.location.href = '/api/payments/upgrade'
            }}
          />
        ) : null}
      </div>
    </fieldset>
  )
}

export const packages: Pkg[] = [
  {
    id: 'free',
    name: 'Free',
    pricePerMonth: 0,
    tagline: 'ה-CRM כולו חינמי לתמיד.',
    included: [
      'לידים ללא הגבלה',
      'משתמשים ללא הגבלה',
      'חיבור פייסבוק, אינסטגרם ו-וואטסאפ',
      'ייבוא לידים מאקסל',
      '10 פעולות AI בחודש במצב מהיר',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    pricePerMonth: 149,
    tagline: 'שכבת ה-AI שמלווה את כל ה-CRM שלך.',
    included: [
      'AI ללא הגבלה במצב מהיר ובמצב חכם',
      'מצב AI מתקדם לניתוח מעמיק',
      'היסטוריית AI מלאה לכל ליד',
      'ניסוח הודעות, המלצות וצעדים הבאים',
      'תכונות AI עתידיות בלי תוספת תשלום',
    ],
  },
]
