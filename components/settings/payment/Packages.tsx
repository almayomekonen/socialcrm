'use client'
import { updatePkg } from '@/actions/agencies'
import { api } from '@/lib/funcs'
import { twMerge } from 'tailwind-merge'
import { Btn } from '@/lib/btns/Btn'

export default function Packages({ curPkg = null }) {
  const isSelected = (pkg) => curPkg === pkg.name
  return (
    <>
      {!curPkg && <div className='text-2xl font-bold my-6'>בחר חבילה</div>}
      <div className='my-6 grid lg:grid-cols-3 gap-8  max-w-6xl '>
        {packages.map((pkg) => (
          <Package key={pkg.name} pkg={pkg} isSelected={isSelected(pkg)} />
        ))}
      </div>
    </>
  )
}

export function Package({ pkg, isSelected }) {
  async function PkgSelected(pkg) {
    api(updatePkg, [pkg])
  }

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

      {!isSelected && (
        <Btn
          lbl={pkg.name === 'שגשוג' ? 'קבלת הצעה' : 'בחירת חבילה'}
          className={twMerge('w-full', pkg.name === 'שגשוג' && 'bg-orange-600 hover:bg-orange-600')}
          onClick={() => {
            PkgSelected(pkg.name)
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
