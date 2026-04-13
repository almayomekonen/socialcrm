'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Check, X } from 'lucide-react'

// --- Types ---

type BillingCycle = 'monthly' | 'annually'

interface Feature {
  name: string
  isIncluded: boolean
}

interface PriceTier {
  id: string
  name: string
  description: string
  priceMonthly: number
  priceAnnually: number
  isPopular: boolean
  badge?: string
  urgency?: string
  buttonLabel: string
  features: Feature[]
}

interface PricingComponentProps extends React.HTMLAttributes<HTMLDivElement> {
  plans: [PriceTier, PriceTier, PriceTier]
  billingCycle: BillingCycle
  onCycleChange: (cycle: BillingCycle) => void
  onPlanSelect: (planId: string, cycle: BillingCycle) => void
}

// --- Feature row ---

const FeatureItem: React.FC<{ feature: Feature; dark?: boolean }> = ({ feature, dark }) => {
  const Icon = feature.isIncluded ? Check : X
  return (
    <li className='flex items-start gap-3 py-2'>
      <Icon
        className={cn(
          'h-4 w-4 shrink-0 mt-0.5',
          feature.isIncluded
            ? dark ? 'text-white' : 'text-gray-900'
            : dark ? 'text-white/25' : 'text-gray-300',
        )}
        aria-hidden='true'
      />
      <span
        className={cn(
          'text-sm',
          feature.isIncluded
            ? dark ? 'text-white/90' : 'text-gray-700'
            : dark ? 'text-white/30' : 'text-gray-300',
        )}
      >
        {feature.name}
      </span>
    </li>
  )
}

// --- Main Component ---

const PricingComponent: React.FC<PricingComponentProps> = ({
  plans,
  billingCycle,
  onCycleChange,
  onPlanSelect,
  className,
  ...props
}) => {
  const annualDiscountPercent = 20
  const allFeatures = Array.from(new Set(plans.flatMap((p) => p.features.map((f) => f.name))))

  const CycleToggle = (
    <div className='flex justify-center mb-10 mt-2'>
      <ToggleGroup
        type='single'
        value={billingCycle}
        onValueChange={(value) => {
          if (value === 'monthly' || value === 'annually') onCycleChange(value)
        }}
        aria-label='מחזור חיוב'
        className='border border-gray-200 rounded-lg p-1 bg-gray-100'
      >
        <ToggleGroupItem
          value='monthly'
          aria-label='חיוב חודשי'
          className='px-6 py-1.5 text-sm font-medium text-gray-500 rounded-md data-[state=on]:bg-white data-[state=on]:text-gray-900 data-[state=on]:shadow-sm transition-colors'
        >
          חודשי
        </ToggleGroupItem>
        <ToggleGroupItem
          value='annually'
          aria-label='חיוב שנתי'
          className='px-6 py-1.5 text-sm font-medium text-gray-500 rounded-md data-[state=on]:bg-white data-[state=on]:text-gray-900 data-[state=on]:shadow-sm transition-colors relative'
        >
          שנתי
          <span className='absolute -top-3 right-0 text-[10px] font-bold text-gray-700 bg-gray-200 px-1.5 rounded-full whitespace-nowrap border border-gray-300'>
            חסוך {annualDiscountPercent}%
          </span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )

  const PricingCards = (
    <div className='grid gap-6 md:grid-cols-3'>
      {plans.map((plan) => {
        const isFeatured = plan.isPopular
        const currentPrice = billingCycle === 'monthly' ? plan.priceMonthly : plan.priceAnnually
        const priceSuffix = billingCycle === 'monthly' ? '/חודש' : '/שנה'
        const isFree = currentPrice === 0

        return (
          <div
            key={plan.id}
            className={cn(
              'flex flex-col rounded-2xl transition-all duration-300',
              isFeatured
                ? 'bg-gray-900 shadow-2xl shadow-gray-900/20 md:scale-[1.03] hover:scale-[1.05]'
                : 'bg-white border border-gray-200 hover:border-gray-300 hover:shadow-md',
            )}
          >
            {/* Header */}
            <div className='p-6 pb-4'>
              <div className='flex justify-between items-start mb-1'>
                <h3 className={cn('text-xl font-bold', isFeatured ? 'text-white' : 'text-gray-900')}>
                  {plan.name}
                </h3>
                {isFeatured && plan.badge && (
                  <span className='text-xs font-bold px-3 py-1 bg-white text-gray-900 rounded-full'>
                    {plan.badge}
                  </span>
                )}
              </div>
              <p className={cn('text-sm mt-1', isFeatured ? 'text-white/60' : 'text-gray-500')}>
                {plan.description}
              </p>
              <div className='mt-5'>
                <p className={cn('text-4xl font-extrabold', isFeatured ? 'text-white' : 'text-gray-900')}>
                  {isFree ? (
                    'חינם'
                  ) : (
                    <>
                      ₪{currentPrice}
                      <span className={cn('text-base font-normal mr-1', isFeatured ? 'text-white/40' : 'text-gray-400')}>
                        {priceSuffix}
                      </span>
                    </>
                  )}
                </p>
                {billingCycle === 'annually' && !isFree && (
                  <p className={cn('text-xs mt-1 line-through', isFeatured ? 'text-white/30' : 'text-gray-400')}>
                    ₪{plan.priceMonthly}/חודש
                  </p>
                )}
              </div>
              {isFeatured && plan.urgency && (
                <p className='text-xs text-white/60 mt-3 font-medium'>{plan.urgency}</p>
              )}
            </div>

            {/* Features */}
            <div className='grow px-6 pb-4'>
              <h4 className={cn('text-xs font-semibold mb-1 uppercase tracking-wider', isFeatured ? 'text-white/40' : 'text-gray-400')}>
                מה כלול:
              </h4>
              <ul className='list-none'>
                {plan.features.slice(0, 5).map((feature) => (
                  <FeatureItem key={feature.name} feature={feature} dark={isFeatured} />
                ))}
                {plan.features.length > 5 && (
                  <li className={cn('text-sm mt-2', isFeatured ? 'text-white/30' : 'text-gray-400')}>
                    + עוד {plan.features.length - 5} פיצ׳רים
                  </li>
                )}
              </ul>
            </div>

            {/* CTA */}
            <div className='p-6 pt-0'>
              <button
                onClick={() => onPlanSelect(plan.id, billingCycle)}
                className={cn(
                  'w-full py-3 px-6 rounded-xl font-bold text-sm transition-all duration-200',
                  isFeatured
                    ? 'bg-white text-gray-900 hover:bg-gray-100'
                    : plan.id === 'enterprise'
                    ? 'bg-transparent border border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white'
                    : 'bg-gray-900 text-white hover:bg-gray-700',
                )}
              >
                {plan.buttonLabel}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )

  const ComparisonTable = (
    <div className='mt-16 hidden md:block rounded-xl overflow-x-auto border border-gray-200'>
      <table className='min-w-full divide-y divide-gray-200'>
        <thead>
          <tr className='bg-gray-50'>
            <th scope='col' className='px-6 py-4 text-start text-sm font-semibold text-gray-500 w-[220px]'>
              פיצ׳ר
            </th>
            {plans.map((plan) => (
              <th
                key={`th-${plan.id}`}
                scope='col'
                className={cn(
                  'px-6 py-4 text-center text-sm font-semibold',
                  plan.isPopular ? 'text-gray-900' : 'text-gray-500',
                )}
              >
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className='divide-y divide-gray-200 bg-white'>
          {allFeatures.map((featureName) => (
            <tr key={featureName} className='hover:bg-gray-50 transition-colors'>
              <td className='px-6 py-3 text-start text-sm text-gray-700'>{featureName}</td>
              {plans.map((plan) => {
                const feature = plan.features.find((f) => f.name === featureName)
                const isIncluded = feature?.isIncluded ?? false
                const Icon = isIncluded ? Check : X
                return (
                  <td
                    key={`${plan.id}-${featureName}`}
                    className={cn('px-6 py-3 text-center', plan.isPopular && 'bg-gray-50')}
                  >
                    <Icon
                      className={cn('h-5 w-5 mx-auto', isIncluded ? 'text-gray-900' : 'text-gray-200')}
                      aria-hidden='true'
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div
      className={cn('w-full py-16 md:py-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8', className)}
      dir='rtl'
      {...props}
    >
      {/* Header */}
      <header className='text-center mb-10'>
        <h2 className='text-3xl sm:text-4xl font-bold text-gray-900 leading-tight'>
          תוכנית שמתאימה לעסק שלך
          <br />
          <span className='text-gray-500'>בלי לפספס יותר לידים</span>
        </h2>
        <p className='mt-4 text-lg text-gray-500 max-w-xl mx-auto'>
          נהל לידים מוואטסאפ, אינסטגרם ופייסבוק במקום אחד וסגור יותר לקוחות
        </p>
      </header>

      {CycleToggle}

      <section aria-labelledby='pricing-plans'>{PricingCards}</section>

      <section aria-label='השוואת פיצ׳רים' className='mt-16'>
        <h3 className='text-2xl font-bold mb-6 hidden md:block text-center text-gray-900'>השוואה מפורטת</h3>
        {ComparisonTable}
      </section>
    </div>
  )
}

// --- Plans data ---

export const israeliPlans: [PriceTier, PriceTier, PriceTier] = [
  {
    id: 'starter',
    name: 'מתחיל',
    description: 'מתאים לעצמאי שרוצה להפסיק לאבד לידים.',
    priceMonthly: 0,
    priceAnnually: 0,
    isPopular: false,
    buttonLabel: 'התחל בחינם',
    features: [
      { name: 'עד 50 לידים', isIncluded: true },
      { name: 'הוספה ידנית של לידים', isIncluded: true },
      { name: 'סטטוסים: חדש / בטיפול / נסגר', isIncluded: true },
      { name: 'הערות על ליד', isIncluded: true },
      { name: 'ייבוא מאקסל', isIncluded: false },
      { name: 'חיבור לפייסבוק ואינסטגרם', isIncluded: false },
      { name: 'ניהול נציגים וצוות', isIncluded: false },
      { name: 'חיפוש מתקדם וסינון', isIncluded: false },
      { name: 'מעקב אחר ביצועי נציגים', isIncluded: false },
      { name: 'תמיכה מועדפת', isIncluded: false },
    ],
  },
  {
    id: 'pro',
    name: 'מקצועי',
    description: 'לעסקים שרוצים לסגור יותר עסקאות בפחות זמן.',
    priceMonthly: 49,
    priceAnnually: 470,
    isPopular: true,
    badge: 'הכי פופולרי',
    urgency: 'רוב המשתמשים בוחרים בתוכנית הזאת',
    buttonLabel: 'שדרג עכשיו',
    features: [
      { name: 'לידים ללא הגבלה', isIncluded: true },
      { name: 'הוספה ידנית של לידים', isIncluded: true },
      { name: 'סטטוסים: חדש / בטיפול / נסגר', isIncluded: true },
      { name: 'הערות על ליד', isIncluded: true },
      { name: 'ייבוא מאקסל', isIncluded: true },
      { name: 'חיבור לפייסבוק ואינסטגרם', isIncluded: true },
      { name: 'ניהול נציגים וצוות', isIncluded: true },
      { name: 'חיפוש מתקדם וסינון', isIncluded: true },
      { name: 'מעקב אחר ביצועי נציגים', isIncluded: false },
      { name: 'תמיכה מועדפת', isIncluded: false },
    ],
  },
  {
    id: 'enterprise',
    name: 'מתקדם',
    description: 'לצוותי מכירות עם מספר נציגים ודרישות מתקדמות.',
    priceMonthly:   149,
    priceAnnually: 1390,
    isPopular: false,
    buttonLabel: 'צור קשר',
    features: [
      { name: 'לידים ללא הגבלה', isIncluded: true },
      { name: 'הוספה ידנית של לידים', isIncluded: true },
      { name: 'סטטוסים: חדש / בטיפול / נסגר', isIncluded: true },
      { name: 'הערות על ליד', isIncluded: true },
      { name: 'ייבוא מאקסל', isIncluded: true },
      { name: 'חיבור לפייסבוק ואינסטגרם', isIncluded: true },
      { name: 'ניהול נציגים וצוות', isIncluded: true },
      { name: 'חיפוש מתקדם וסינון', isIncluded: true },
      { name: 'מעקב אחר ביצועי נציגים', isIncluded: true },
      { name: 'תמיכה מועדפת', isIncluded: true },
    ],
  },
]

// --- Standalone page wrapper ---

export default function PricingPageComponent() {
  const [cycle, setCycle] = React.useState<BillingCycle>('annually')
  const router = useRouter()

  const handlePlanSelect = (planId: string) => {
    if (planId === 'enterprise') {
      router.push('/auth?plan=enterprise')
    } else {
      router.push('/auth/register')
    }
  }

  return (
    <div className='min-h-screen bg-white'>
      <PricingComponent
        plans={israeliPlans}
        billingCycle={cycle}
        onCycleChange={setCycle}
        onPlanSelect={handlePlanSelect}
      />

      <TrustSection />

      <PricingFAQ />
    </div>
  )
}

// --- Trust section ---

function TrustSection() {
  const points = [
    { text: 'לא שוכחים אף ליד' },
    { text: 'כל השיחות במקום אחד' },
    { text: 'סוגרים יותר עסקאות בפחות זמן' },
  ]

  return (
    <div className='max-w-6xl mx-auto px-4 pb-16' dir='rtl'>
      <div className='rounded-2xl p-8 md:p-12 text-center border border-gray-200 bg-gray-50'>
        <h3 className='text-2xl font-bold text-gray-900 mb-8'>למה עסקים עוברים ל-Social CRM?</h3>
        <div className='grid md:grid-cols-3 gap-6'>
          {points.map((p) => (
            <div key={p.text} className='flex flex-col items-center gap-3'>
              <div className='size-12 rounded-full flex items-center justify-center bg-gray-900'>
                <Check className='w-5 h-5 text-white' />
              </div>
              <p className='text-gray-700 font-medium'>{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// --- FAQ section ---

const faqs = [
  { q: 'האם אפשר להתחיל בחינם?', a: 'כן. תוכנית המתחיל היא חינמית לגמרי ולא דורשת כרטיס אשראי. ניתן לנהל עד 50 לידים ללא תשלום.' },
  { q: 'אפשר לבטל בכל רגע?', a: 'כן. אין התחייבות וניתן לבטל את המנוי בכל עת, ישירות מהחשבון. לא נחייב אחרי הביטול.' },
  { q: 'זה מתאים גם לעסק קטן?', a: 'בהחלט. המערכת תוכננה ספציפית לעסקים קטנים וקואצ\'ים שמקבלים לידים ממדיה חברתית. פשוטה, בעברית, עובדת.' },
  { q: 'צריך ידע טכני?', a: 'ממש לא. ההרשמה לוקחת פחות מדקה, חיבור לפייסבוק 5 דקות, וייבוא מאקסל — שניות. לא נדרש ניסיון קודם.' },
]

function PricingFAQ() {
  const [open, setOpen] = React.useState<number | null>(null)

  return (
    <div className='max-w-2xl mx-auto px-4 pb-24' dir='rtl'>
      <h3 className='text-2xl font-bold text-gray-900 text-center mb-8'>שאלות נפוצות</h3>
      <div className='space-y-3'>
        {faqs.map((faq, i) => (
          <div key={i} className='rounded-xl border border-gray-200 overflow-hidden bg-white'>
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className='w-full flex justify-between items-center px-5 py-4 text-right text-gray-900 font-medium hover:bg-gray-50 transition-colors'
            >
              <span>{faq.q}</span>
              <span className='text-gray-400 text-lg ml-2 shrink-0'>{open === i ? '−' : '+'}</span>
            </button>
            {open === i && (
              <div className='px-5 pb-4 text-sm text-gray-600 leading-relaxed'>{faq.a}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
