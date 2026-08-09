import Icon from '@/lib/Icon'
import { ANNUAL_SAVINGS, PRICING } from '@/lib/pricing'
import type { SubscriptionView } from '@/lib/quota/subscription'
import ManagePlanLauncher, { type SubscriptionClientView } from './ManagePlanLauncher'
import PaymentMethodRow from './PaymentMethodRow'
import PlanIncludesDisclosure from './PlanIncludesDisclosure'
import { daysUntil, formatRenewalDate, relativeDaysLabel } from './subscriptionDates'

/**
 * The billing centre's subscription card. Server Component.
 *
 * It owns the whole card — header block plus the payment-method footer band —
 * because the band needs a divider inside the card's border. The non-Pro
 * branches on the page keep their original wrapper untouched.
 *
 * Everything on it answers one of the five questions a subscriber has: what
 * plan, when it renews, what it costs, what it includes, what gets charged.
 * There is no comparison, no upgrade marketing and no Free card — the customer
 * already bought.
 *
 * `status` stays the source of truth for the cancelled state (deriveStatus):
 * 'cancelling' means renewal is already off but Pro access runs to expiresAt,
 * so that date is an access-end date, not a next charge — the labels below
 * switch accordingly, and the annual offer disappears entirely. Pitching an
 * upsell to someone who has just cancelled is the commercial ask the care
 * charter puts furthest out of bounds.
 *
 * Date serialization happens here at the server→client boundary: the
 * SubscriptionView's `expiresAt: Date | null` becomes `expiresAtIso` for the
 * client component, and the renewal date and day count are rendered to text
 * server-side so no Client Component ever recomputes a day boundary.
 */
export default function ProPlanCard({
  subscription,
  annualAvailable = false,
}: {
  subscription: SubscriptionView
  annualAvailable?: boolean
}) {
  const cancelling = subscription.status === 'cancelling'
  const annual = subscription.billingPeriod === 'annual'

  const dateLabel = cancelling ? 'גישה ל־Pro עד' : 'החידוש הבא'
  const periodLabel = annual ? 'שנתית' : 'חודשית'
  const priceLabel = annual ? `₪${PRICING.annual} לשנה` : `₪${PRICING.monthly} לחודש`

  // Only offered to an active monthly subscriber, and only when the annual
  // link is actually configured — the upgrade route bounces an unconfigured
  // annual request rather than charging the monthly amount.
  const showAnnualOffer = annualAvailable && !cancelling && !annual

  const clientView: SubscriptionClientView = {
    plan: subscription.plan,
    expiresAtIso: subscription.expiresAt ? subscription.expiresAt.toISOString() : null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    status: subscription.status,
    manageable: subscription.manageable,
  }

  return (
    <div className='mb-6 max-w-3xl rounded-lg border border-gray-200 bg-white'>
      <div className='flex items-start justify-between gap-8 p-6 mobile:flex-col mobile:gap-6'>
        <div className='flex flex-col gap-3'>
          <div className='flex items-center gap-3'>
            <p className='text-lg font-semibold'>מסלול נוכחי: Pro</p>
            <StatusBadge cancelling={cancelling} />
          </div>

          <div className='flex flex-col gap-2'>
            <p className='text-sm text-gray-500'>
              תקופת חיוב: {periodLabel} · {priceLabel}
            </p>

            {subscription.expiresAt && (
              <div className='flex items-center gap-2 text-sm text-gray-700'>
                <Icon name='calendar' type='reg' className='size-4 shrink-0 bg-gray-400' />
                <span>
                  {dateLabel}: {formatRenewalDate(subscription.expiresAt)}
                  <span className='text-gray-500'> · {relativeDaysLabel(daysUntil(subscription.expiresAt))}</span>
                </span>
              </div>
            )}

            <PlanIncludesDisclosure />
          </div>
        </div>

        <div className='flex shrink-0 flex-col items-end gap-3 mobile:w-full mobile:items-start'>
          <ManagePlanLauncher subscription={clientView} />
          {showAnnualOffer && (
            <a
              href='/api/payments/upgrade?period=annual&source=billing_subscription_card'
              className='text-sm text-solid hover:underline'
            >
              מעבר לחיוב שנתי · ₪{PRICING.annual} לשנה, חיסכון ₪{ANNUAL_SAVINGS}
            </a>
          )}
        </div>
      </div>

      <PaymentMethodRow />
    </div>
  )
}

/** Status carries a text label, never colour alone. */
function StatusBadge({ cancelling }: { cancelling: boolean }) {
  if (cancelling) {
    return (
      <span className='inline-flex items-center gap-2 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800'>
        <span aria-hidden='true' className='size-1.5 rounded-full bg-amber-500' />
        המנוי בוטל
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-2 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700'>
      <span aria-hidden='true' className='size-1.5 rounded-full bg-green-600' />
      מנוי פעיל
    </span>
  )
}
