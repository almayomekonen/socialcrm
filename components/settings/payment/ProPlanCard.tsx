import Icon from '@/lib/Icon'
import { PRICING } from '@/lib/pricing'
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
 * switch accordingly.
 *
 * There is no annual upsell here any more: this release sells one thing, a
 * monthly subscription on a saved card. The old link went to the retired
 * Payment Link checkout.
 *
 * Date serialization happens here at the server→client boundary: the
 * SubscriptionView's `expiresAt: Date | null` becomes `expiresAtIso` for the
 * client component, and the renewal date and day count are rendered to text
 * server-side so no Client Component ever recomputes a day boundary.
 */
export default function ProPlanCard({
  subscription,
  hasAccess = true,
}: {
  subscription: SubscriptionView
  /**
   * From `getAgencyProductAccess` — the SAME gate that refuses every request.
   * Passed in rather than derived here: `agencies.plan` stays 'pro' after a paid
   * period lapses, so this card used to show a green "מנוי פעיל" chip and a
   * renewal date already in the past to a customer whose every action was being
   * refused. The one screen that must tell the truth was the one that didn't.
   */
  hasAccess?: boolean
}) {
  const expired = !hasAccess
  const cancelling = !expired && subscription.status === 'cancelling'
  const annual = subscription.billingPeriod === 'annual'
  /* An explicit grant has no billing period, no renewal and nothing to cancel.
     Naming a price here would invent a charge that will never be made. */
  const granted = subscription.source === 'grant'

  const dateLabel = expired ? 'המנוי הסתיים ב' : cancelling ? 'גישה ל־Pro עד' : 'החידוש הבא'
  const periodLabel = annual ? 'שנתית' : 'חודשית'
  const priceLabel = annual ? `₪${PRICING.annual} לשנה` : `₪${PRICING.monthly} לחודש`


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
            <StatusBadge cancelling={cancelling} expired={expired} />
          </div>

          <div className='flex flex-col gap-2'>
            <p className='text-sm text-gray-500'>
              {granted ? 'גישה מלאה ל־Pro · ללא חיוב ובלי תאריך סיום' : `תקופת חיוב: ${periodLabel} · ${priceLabel}`}
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

        {/* Nothing to manage on a grant: no renewal to stop, no period to
            cancel. Left in place for every real subscription, including the
            legacy rows with no subscriptions record. */}
        {!granted && (
          <div className='flex shrink-0 flex-col items-end gap-3 mobile:w-full mobile:items-start'>
            <ManagePlanLauncher subscription={clientView} />
          </div>
        )}
      </div>

      <PaymentMethodRow state={granted ? 'granted' : expired ? 'expired' : cancelling ? 'cancelling' : 'renewing'} />
    </div>
  )
}

/** Status carries a text label, never colour alone. */
function StatusBadge({ cancelling, expired = false }: { cancelling: boolean; expired?: boolean }) {
  if (expired) {
    return (
      <span className='inline-flex items-center gap-2 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700'>
        <span aria-hidden='true' className='size-1.5 rounded-full bg-red-600' />
        המנוי הסתיים
      </span>
    )
  }
  // Reads "request received", not "cancelled". The badge is driven by
  // `cancelAtPeriodEnd`, a flag this app sets on its own subscriptions row;
  // nothing contacts the payment provider to stop the standing order, so
  // "המנוי בוטל" asserted an outcome that had not been performed or observed.
  // Amber is unchanged — this is still a state between active and ended.
  if (cancelling) {
    return (
      <span className='inline-flex items-center gap-2 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800'>
        <span aria-hidden='true' className='size-1.5 rounded-full bg-amber-500' />
        בקשת הביטול נקלטה
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
