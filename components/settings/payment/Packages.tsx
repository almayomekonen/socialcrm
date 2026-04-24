'use client'
import { twMerge } from 'tailwind-merge'
import { Btn } from '@/lib/btns/Btn'

type PackagesProps = { plan?: string }

export default function Packages({ plan = 'free' }: PackagesProps) {
  return (
    <div className='my-6 grid lg:grid-cols-3 gap-8  max-w-6xl '>
      {packages.map((pkg) => (
        <Package key={pkg.name} pkg={pkg} plan={plan} />
      ))}
    </div>
  )
}

export function Package({ pkg, plan }: { pkg: typeof packages[number]; plan: string }) {
  const isPro = plan === 'pro'
  const isFreeTier = pkg.pricePerMonth === 0
  const isPaidTier = pkg.pricePerMonth !== null && pkg.pricePerMonth > 0
  const isCustomTier = pkg.pricePerMonth === null

  // Free plan → free tier is "current".
  // Pro plan  → no specific paid tier is known; no "current" label.
  const isSelected = !isPro && isFreeTier

  return (
    <fieldset
      className={twMerge('bg-white max-w-sm  p-6 border rounded-lg  flex flex-col justify-between', isSelected && 'border-solid')}
    >
      {isSelected && <legend className='bg-solid text-white rounded-full px-4 text-center'>החבילה שלך</legend>}

      <div className='space-y-2'>
        <h2 className='text-2xl font-bold'>{pkg.name}</h2>
        {pkg.pricePerMonth !== null && (
          <p className='text-2xl font-bold'>
            ₪{pkg.pricePerMonth} <span className='text-lg'>/ לחודש</span>
          </p>
        )}
        <div className='border-t border-b py-2 my-4'>
          <p className={twMerge('font-semibold', pkg.name === 'שגשוג' ? 'text-orange-600' : 'text-solid')}>{pkg.description}</p>
        </div>
        <h3 className='font-bold '>מה כלול:</h3>
        <ul className='list-disc px-4'>
          {pkg.included.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      {isPro && (isPaidTier || isCustomTier) && (
        <p className='mt-4 text-sm font-semibold text-green-700'>פעיל במסלול Pro</p>
      )}

      {!isPro && (isPaidTier || isCustomTier) && (
        <Btn
          lbl={isCustomTier ? 'קבלת הצעה' : 'שדרג למסלול Pro'}
          className={twMerge('w-full', pkg.name === 'שגשוג' && 'bg-orange-600 hover:bg-orange-600')}
          onClick={() => {
            window.location.href = '/api/payments/upgrade'
          }}
        />
      )}
    </fieldset>
  )
}

export const packages = [
  {
    name: 'ניצן',
    pricePerMonth: 0,
    description: 'מערכת בסיסית למעקב לידים ולקוחות',
    included: ['מערכת לניהול לקוחות ומשימות', 'ייבוא לידים ממקורות חיצוניים', 'ניהול פייפליין מכירות'],
  },
  {
    name: 'מקפצה',
    pricePerMonth: 59,
    description: 'מערכת מלאה לטיפול בלידים ולקוחות',
    included: [
      'מערכת לניהול לקוחות ומשימות',
      'ייבוא לידים ממקורות חיצוניים',
      'ניהול פייפליין מכירות',
      'אוטומציות ייבוא וטיפול בלידים',
      'הצטרפות לידים אוטומטית',
      'בוטים',
      'תובנות AI',
      'אוטומציות',
    ],
  },
  {
    name: 'פריחה',
    pricePerMonth: 120,
    description: 'כל מה שעסק קטן צריך במערכת אחת',
    included: [
      'מערכת לניהול לקוחות ומשימות',
      'ייבוא לידים ממקורות חיצוניים',
      'ניהול פייפליין מכירות',
      'אוטומציות ייבוא וטיפול בלידים',
      'הצטרפות לידים אוטומטית',
      'בוטים',
      'תובנות AI',
      'אוטומציות',
      'יצירת מסמכים',
      'מעקב עלויות החזר',
      'הסכמי עמלה',
    ],
  },
  {
    name: 'שגשוג',
    pricePerMonth: null, // התאמה אישית
    description: 'חבילה מותאמת אישית עבור עסקים',
    included: ['שיחה עם מומחה להצלחת לקוח לבניית תוכנית שמותאמת בדיוק עבור הצרכים שלכם'],
  },
]
