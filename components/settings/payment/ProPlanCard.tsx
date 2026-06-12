import { formatDate } from '@/lib/dates'
import type { SubscriptionView } from '@/lib/quota/subscription'
import ManagePlanLauncher, { type SubscriptionClientView } from './ManagePlanLauncher'

/**
 * Pro plan summary. Server component.
 *
 * Renders as a React Fragment with two direct children so it slots into the
 * existing card's outer flex container (`flex items-center justify-between
 * gap-4`) without introducing a new wrapper or shifting spacing.
 *
 * Date serialization happens here at the server→client boundary: the
 * SubscriptionView's `expiresAt: Date | null` is converted to
 * `expiresAtIso: string | null` for the client component. The client never
 * receives a raw `Date` object — avoids hydration mismatch and "Date is not
 * a function" footguns in optimistic state mirrors.
 */
export default function ProPlanCard({ subscription }: { subscription: SubscriptionView }) {
  const statusLabel = subscription.status === 'cancelling' ? 'חידוש הופסק' : 'פעיל'
  const clientView: SubscriptionClientView = {
    plan: subscription.plan,
    expiresAtIso: subscription.expiresAt ? subscription.expiresAt.toISOString() : null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    status: subscription.status,
    manageable: subscription.manageable,
  }

  return (
    <>
      <div>
        <p className='text-lg font-semibold'>מסלול נוכחי: Pro</p>
        <p className='text-sm text-gray-500'>
          תקופת חיוב: {subscription.billingPeriod === 'annual' ? 'שנתית' : 'חודשית'}
        </p>
        {subscription.expiresAt && (
          <p className='text-sm text-gray-500'>בתוקף עד: {formatDate(subscription.expiresAt)}</p>
        )}
        <p className='text-sm text-gray-500'>סטטוס: {statusLabel}</p>
      </div>
      <ManagePlanLauncher subscription={clientView} />
    </>
  )
}
