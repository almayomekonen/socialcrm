'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Check } from 'lucide-react'
import { PRICING, ANNUAL_DISCOUNT_PERCENT } from '@/lib/pricing'

/**
 * AI-first pricing page. Two plans, one decision: do you want the AI layer or not.
 *
 * Positioning doctrine:
 *   - The CRM is free, fully usable, no lead cap.
 *   - Pro = the AI brain of the CRM. Everything AI-related lives behind Pro.
 *   - Workspace-priced, not per-seat. Team size doesn't change the bill.
 *   - No credits, no token language, no usage anxiety. Pro feels unlimited.
 *
 * The comparison matrix from the previous version was intentionally removed:
 * a two-plan decision doesn't need one and the matrix flattens AI's narrative
 * weight into a checkmark column.
 */

type BillingCycle = 'monthly' | 'annually'

type PlanId = 'free' | 'pro'

interface PriceTier {
  id: PlanId
  name: string
  tagline: string
  priceMonthly: number
  priceAnnually: number
  isFeatured: boolean
  badge?: string
  buttonLabel: string
  features: string[]
}

export const israeliPlans: [PriceTier, PriceTier] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'ה-CRM כולו חינמי לתמיד.',
    priceMonthly: 0,
    priceAnnually: 0,
    isFeatured: false,
    buttonLabel: 'התחל בחינם',
    features: [
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
    tagline: 'שכבת ה-AI שמלווה את כל ה-CRM שלך.',
    priceMonthly: PRICING.monthly,
    priceAnnually: PRICING.annual,
    isFeatured: true,
    badge: 'המומלץ',
    buttonLabel: 'שדרג ל-Pro',
    features: [
      'כל מה שיש ב-Free',
      'AI ללא הגבלה במצב מהיר ובמצב חכם',
      'מצב AI מתקדם לניתוח מורכב',
      'היסטוריית AI מלאה לכל ליד',
      'ניסוח הודעות, המלצות וצעדים הבאים בלחיצה אחת',
      'מחיר אחד לכל הצוות, ללא תוספת לכל נציג',
      'תכונות AI עתידיות בלי תוספת תשלום',
    ],
  },
]


interface PricingComponentProps extends React.HTMLAttributes<HTMLDivElement> {
  plans: [PriceTier, PriceTier]
  billingCycle: BillingCycle
  onCycleChange: (cycle: BillingCycle) => void
  onPlanSelect: (planId: PlanId, cycle: BillingCycle) => void
}

const PricingComponent: React.FC<PricingComponentProps> = ({
  plans,
  billingCycle,
  onCycleChange,
  onPlanSelect,
  className,
  ...props
}) => {
  return (
    <div
      className={cn('w-full py-16 md:py-24 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8', className)}
      dir='rtl'
      {...props}
    >
      <header className='text-center mb-10 max-w-2xl mx-auto'>
        <h2 className='text-3xl sm:text-4xl font-bold text-gray-900 leading-tight'>
          ה-CRM כולו חינמי.
          <br />
          <span className='text-gray-500'>שכבת ה-AI נפתחת ב-Pro.</span>
        </h2>
        <p className='mt-5 text-base sm:text-lg text-gray-500'>
          שכבת ה-AI ב-Pro מלווה כל ליד ומסייעת בניסוח הודעות, בהמלצות על הצעדים הבאים ובמענה לשאלות. כל אינטראקציה
          נשמרת בהיסטוריית הליד ונשארת זמינה לכל הצוות.
        </p>
      </header>

      <CycleToggle billingCycle={billingCycle} onCycleChange={onCycleChange} />

      <section aria-labelledby='pricing-plans' className='mt-2'>
        <div className='grid gap-6 md:grid-cols-2 max-w-3xl mx-auto'>
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} billingCycle={billingCycle} onSelect={onPlanSelect} />
          ))}
        </div>
      </section>

      <p className='text-center text-xs text-gray-400 mt-6'>
        ללא התחייבות, ניתן לבטל בכל רגע. המחיר הוא לסביבת עבודה אחת וכולל את כל הצוות.
      </p>
    </div>
  )
}

function CycleToggle({
  billingCycle,
  onCycleChange,
}: {
  billingCycle: BillingCycle
  onCycleChange: (cycle: BillingCycle) => void
}) {
  return (
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
            חסוך {ANNUAL_DISCOUNT_PERCENT}%
          </span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

function PlanCard({
  plan,
  billingCycle,
  onSelect,
}: {
  plan: PriceTier
  billingCycle: BillingCycle
  onSelect: (planId: PlanId, cycle: BillingCycle) => void
}) {
  const isFeatured = plan.isFeatured
  const currentPrice = billingCycle === 'monthly' ? plan.priceMonthly : plan.priceAnnually
  const priceSuffix = billingCycle === 'monthly' ? '/חודש' : '/שנה'
  const isFree = currentPrice === 0
  const monthlyEquivalent = billingCycle === 'annually' && !isFree ? Math.round(plan.priceAnnually / 12) : null

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl transition-all duration-300',
        isFeatured
          ? 'bg-gray-900 shadow-2xl shadow-gray-900/20 md:scale-[1.02] hover:scale-[1.04]'
          : 'bg-white border border-gray-200 hover:border-gray-300 hover:shadow-md',
      )}
    >
      <div className='p-7 pb-4'>
        <div className='flex justify-between items-start mb-2'>
          <h3 className={cn('text-xl font-bold', isFeatured ? 'text-white' : 'text-gray-900')}>{plan.name}</h3>
          {isFeatured && plan.badge && (
            <span className='text-xs font-bold px-3 py-1 bg-white text-gray-900 rounded-full'>{plan.badge}</span>
          )}
        </div>
        <p className={cn('text-sm', isFeatured ? 'text-white/70' : 'text-gray-500')}>{plan.tagline}</p>

        <div className='mt-6'>
          <p className={cn('text-4xl font-extrabold', isFeatured ? 'text-white' : 'text-gray-900')}>
            {isFree ? (
              'חינם'
            ) : (
              <>
                ₪{currentPrice}
                <span className={cn('text-base font-normal mr-1', isFeatured ? 'text-white/50' : 'text-gray-400')}>
                  {priceSuffix}
                </span>
              </>
            )}
          </p>
          {monthlyEquivalent !== null && (
            <p className={cn('text-xs mt-1', isFeatured ? 'text-white/40' : 'text-gray-400')}>
              ₪{monthlyEquivalent} לחודש בחישוב שנתי
            </p>
          )}
          {!isFree && (
            <p className={cn('text-[11px] mt-1', isFeatured ? 'text-white/40' : 'text-gray-400')}>
              לסביבת עבודה, כולל את כל הצוות.
            </p>
          )}
        </div>
      </div>

      <div className='grow px-7 pb-5'>
        <ul className='list-none space-y-2.5'>
          {plan.features.map((feature) => (
            <li key={feature} className='flex items-start gap-3'>
              <Check
                className={cn('h-4 w-4 shrink-0 mt-0.5', isFeatured ? 'text-white' : 'text-gray-900')}
                aria-hidden='true'
              />
              <span className={cn('text-sm', isFeatured ? 'text-white/90' : 'text-gray-700')}>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className='p-7 pt-0'>
        <button
          onClick={() => onSelect(plan.id, billingCycle)}
          className={cn(
            'w-full py-3 px-6 rounded-xl font-bold text-sm transition-all duration-200',
            isFeatured ? 'bg-white text-gray-900 hover:bg-gray-100' : 'bg-gray-900 text-white hover:bg-gray-700',
          )}
        >
          {plan.buttonLabel}
        </button>
      </div>
    </div>
  )
}

export default function PricingPageComponent() {
  // Annual is the recommended option — it opens selected (spec: pricing alignment).
  const [cycle, setCycle] = React.useState<BillingCycle>('annually')
  const router = useRouter()

  const handlePlanSelect = (_planId: PlanId) => {
    // Both plans start at /auth/register today; the Pro upgrade fires in-app
    // after a free workspace is provisioned. Pricing UX phase — billing
    // routing is intentionally not implemented here.
    router.push('/auth/register')
  }

  return (
    <div className='min-h-screen bg-white'>
      <PricingComponent plans={israeliPlans} billingCycle={cycle} onCycleChange={setCycle} onPlanSelect={handlePlanSelect} />

      <AiValueSection />

      <WhatChangesSection />

      <PricingFAQ />
    </div>
  )
}

function AiValueSection() {
  const points = [
    {
      title: 'AI שמלווה כל ליד',
      body: 'שכבה אופרטיבית שזוכרת את ההיסטוריה של כל ליד וממליצה על הצעד הבא.',
    },
    {
      title: 'ניסוח בלחיצה',
      body: 'הודעות מעקב, המלצות ומענה לשאלות, מותאם להקשר של כל ליד.',
    },
    {
      title: 'מחיר אחד לסביבת עבודה',
      body: 'משלמים פעם אחת לסביבת העבודה, ללא תוספת לכל נציג. צוות של חמישה משלם בדיוק כמו עצמאי.',
    },
  ]

  return (
    <div className='max-w-5xl mx-auto px-4 pb-16' dir='rtl'>
      <div className='rounded-2xl p-8 md:p-12 border border-gray-200 bg-gray-50'>
        <h3 className='text-2xl font-bold text-gray-900 mb-8 text-center'>למה Pro</h3>
        <div className='grid md:grid-cols-3 gap-6'>
          {points.map((p) => (
            <div key={p.title} className='flex flex-col gap-2'>
              <p className='text-gray-900 font-semibold'>{p.title}</p>
              <p className='text-sm text-gray-600 leading-relaxed'>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Workflow-change comparison. Sits between the conceptual AI-value section
 * and the FAQ. Five operational rows showing how a single moment in the
 * rep's day changes once the AI layer is on top of the CRM.
 *
 * Not a feature matrix. The columns aren't "checked / unchecked" — they
 * are narrative descriptions of what the rep does at that workflow step in
 * each plan. Free reads as "you do this manually"; Pro reads as "the AI
 * handles this with continuity."
 */

const workflowRows: { topic: string; free: string; pro: string }[] = [
  {
    topic: 'ניסוח הודעות מעקב',
    free: 'כתיבה ידנית של כל הודעת מעקב מההתחלה.',
    pro: 'ניסוח מותאם להקשר של הליד בלחיצה אחת.',
  },
  {
    topic: 'הצעד הבא',
    free: 'החלטה לפי הניסיון של הנציג בלבד.',
    pro: 'המלצה תפעולית בהתבסס על סטטוס הליד וההיסטוריה שלו.',
  },
  {
    topic: 'שאלות פתוחות על ליד',
    free: 'מעבר ידני על הערות, משימות וקבצים.',
    pro: 'מענה AI עם הקשר מלא של הליד.',
  },
  {
    topic: 'היסטוריית AI לכל ליד',
    free: 'אין היסטוריית AI ייעודית.',
    pro: 'היסטוריה אופרטיבית מלאה לכל ליד, זמינה לכל הצוות.',
  },
  {
    topic: 'כמות פעולות AI',
    free: '10 פעולות בחודש במצב מהיר.',
    pro: 'ללא הגבלה במצב מהיר וחכם, עם מצב מתקדם לניתוח עמוק.',
  },
]

function WhatChangesSection() {
  return (
    <div className='max-w-4xl mx-auto px-4 pb-16' dir='rtl'>
      <header className='text-center mb-10 max-w-xl mx-auto'>
        <h3 className='text-2xl font-bold text-gray-900 mb-3'>מה משתנה ב-Pro</h3>
        <p className='text-sm text-gray-500 leading-relaxed'>
          ה-CRM נשאר זהה בשני המסלולים. ההבדל הוא בשכבת ה-AI שמופעלת מעל לכל ליד.
        </p>
      </header>

      <div className='rounded-2xl border border-gray-200 overflow-hidden bg-white'>
        <div className='hidden md:grid md:grid-cols-[1.4fr_2fr_2fr] gap-6 px-6 py-3 bg-gray-50 border-b border-gray-100'>
          <span className='text-[10px] tracking-wider text-gray-400 font-semibold uppercase'>תהליך</span>
          <span className='text-[10px] tracking-wider text-gray-400 font-semibold uppercase'>Free</span>
          <span className='text-[10px] tracking-wider text-gray-400 font-semibold uppercase'>Pro</span>
        </div>

        {workflowRows.map((row, idx) => (
          <div
            key={row.topic}
            className={cn(
              'grid gap-4 md:grid-cols-[1.4fr_2fr_2fr] md:gap-6 px-5 py-5 md:px-6',
              idx > 0 && 'border-t border-gray-100',
            )}
          >
            <div className='font-semibold text-gray-900 text-sm leading-snug'>{row.topic}</div>

            <div>
              <span className='md:hidden text-[10px] tracking-wider text-gray-400 font-semibold uppercase block mb-1'>
                Free
              </span>
              <p className='text-sm text-gray-500 leading-relaxed'>{row.free}</p>
            </div>

            <div>
              <span className='md:hidden text-[10px] tracking-wider text-gray-400 font-semibold uppercase block mb-1'>
                Pro
              </span>
              <p className='text-sm text-gray-900 leading-relaxed'>{row.pro}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const faqs = [
  {
    q: 'האם ה-CRM באמת חינם לגמרי?',
    a: 'כן. כל ניהול הלידים נשאר חינם לתמיד, כולל החיבורים, הייבוא, הצוות והמעקב. רק שימוש מתקדם ב-AI דורש שדרוג ל-Pro.',
  },
  {
    q: 'מה ההבדל בין מצבי ה-AI?',
    a: 'מצב מהיר נותן תשובה זריזה לשאלות פשוטות וזמין לכל המשתמשים. מצב חכם מאזן בין דיוק למהירות וזמין ב-Pro ללא הגבלה. מצב מתקדם מבצע ניתוח מעמיק של ליד וזמין ב-Pro עם מכסה חודשית נדיבה.',
  },
  {
    q: 'האם הצוות שלי משלם לכל נציג?',
    a: 'לא. ב-Pro משלמים פעם אחת לסביבת העבודה ללא תוספת לכל משתמש. צוות של חמישה משלם בדיוק כמו עצמאי.',
  },
  {
    q: 'אפשר לבטל בכל רגע?',
    a: 'כן, אין התחייבות. ניתן לבטל את ה-Pro בכל רגע, וה-CRM ימשיך לעבוד חינם וכל הנתונים יישארו במקום.',
  },
  {
    q: 'האם ה-AI שומר היסטוריה לכל ליד?',
    a: 'כן. כל אינטראקציה עם ה-AI נשמרת על הליד, כולל ניסוח הודעות, המלצות ושאלות. הצוות כולו רואה את אותו ההקשר.',
  },
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
            {open === i && <div className='px-5 pb-4 text-sm text-gray-600 leading-relaxed'>{faq.a}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
