import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { isAdmin } from '@/types/roles'
import { getAgencyPlan } from '@/lib/quota'
import { getPlanUsage } from '@/lib/quota/planUsage'
import { getSubscriptionView } from '@/lib/quota/subscription'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import Packages from '@/components/settings/payment/Packages'
import UpgradeBtn from '@/components/settings/payment/UpgradeBtn'
import ProPlanCard from '@/components/settings/payment/ProPlanCard'
import SubscriptionUsage from '@/components/settings/payment/SubscriptionUsage'
import BillingHistory from '@/components/settings/payment/BillingHistory'
import TrialStatusCard from '@/components/trial/TrialStatusCard'
import Icon from '@/lib/Icon'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import { isAnnualLinkConfigured } from '@/lib/payments/link'

type SearchParams = Promise<{ mode?: string | string[] }>

/**
 * Settings → מנוי ותשלום. Two audiences, one route.
 *
 * A SUBSCRIBER gets a billing centre (design round 7b): plan, renewal, usage,
 * invoices, payment method, trust note — and nothing that sells. The חבילות
 * comparison, the Free card and the upgrade CTA are deliberately absent for
 * them; they already bought, and re-pitching a paying customer is the upsell
 * wearing a helpful costume that care-charter §12 rules out.
 *
 * A FREE OR TRIALLING agency still needs somewhere to subscribe, and חבילות is
 * the only surface that offers it — the trial card's "בחר מסלול להמשך" anchors
 * to #packages further down this same page. So the section is gated on
 * `!isPro` rather than deleted: removing it for everyone would not be polish,
 * it would delete the product's checkout.
 *
 * Everything the subscriber sees is counted or stored, never derived. Card
 * digits, per-charge amounts and invoice documents are absent because this
 * system does not record them — see PaymentMethodRow and BillingHistory.
 */
export default async function page({ searchParams }: { searchParams?: SearchParams }) {
  const sp = searchParams ? await searchParams : {}
  const isLocalMode = sp.mode === 'local'

  const user = await getUser()
  /**
   * The nav entry for this page sits inside the `role == 'ADMIN'` block, so it
   * was hidden from other roles — but hidden is not denied. The page itself had
   * no role check, and a direct URL rendered the agency's plan, usage and
   * billing history to any authenticated user. `isAdmin` is the predicate the
   * subscription actions use, so page and action now agree.
   */
  if (!user || !isAdmin(user.role)) {
    return <div>אין לך הרשאה לצפות בדף זה</div>
  }
  const productAccess = await getAgencyProductAccess(user.agencyId)
  const plan = await getAgencyPlan(user.agencyId)
  const isPro = plan === 'pro'
  const subscription = isPro ? await getSubscriptionView(user.agencyId) : null

  const trialRow = isPro ? null : await getAgencyTrial(user.agencyId)
  const trial = trialRow ? getTrialState(trialRow, new Date()) : null
  const trialActive = trial?.status === 'TRIAL_ACTIVE'

  const charges = await db('payments')
    .where({ agencyId: user.agencyId })
    .orderBy('createdAt', 'desc')
    .select('id', 'transactionId', 'createdAt')

  // Usage only describes a subscription, so it is read only when there is one.
  const usage = isPro ? await getPlanUsage(user.agencyId, plan) : null

  return (
    <div>
      <h1 className='title mb-8'>פרטי חבילה ותשלום</h1>

      {isLocalMode && (
        <div
          role='status'
          dir='rtl'
          className='mb-6 max-w-3xl p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3'
        >
          <Icon name='circle-exclamation' className='bg-amber-700 size-5 mt-0.5 shrink-0' />
          <div className='space-y-1 text-sm'>
            <p className='font-semibold text-amber-900'>מצב פיתוח</p>
            <p className='text-amber-800'>תשלומים אמיתיים אינם זמינים בסביבת פיתוח.</p>
            <p className='text-amber-800'>כדי לבדוק תשלומים אמיתיים השתמש בפרודקשן.</p>
          </div>
        </div>
      )}

      {trialActive && trial?.endsAt && trialRow?.trialStartedAt && (
        <TrialStatusCard
          startedAt={new Date(trialRow.trialStartedAt)}
          endsAt={trial.endsAt}
          daysRemaining={trial.daysRemaining ?? 0}
        />
      )}

      {isPro && subscription ? (
        <>
          {/* Named first so the truth is the first thing read on the page. */}
          {!productAccess.hasAccess && (
            <div className='mb-6 max-w-3xl'>
              <SubscriptionExpiredState mode='inline' source='billing_page' />
            </div>
          )}
          <ProPlanCard
            subscription={subscription}
            annualAvailable={isAnnualLinkConfigured()}
            hasAccess={productAccess.hasAccess}
          />
        </>
      ) : (
        <div className='mb-6 max-w-3xl p-6 bg-white rounded-lg border border-gray-200 flex items-center justify-between gap-4'>
          {trialActive ? (
            <>
              <div>
                <p className='text-lg font-semibold'>מסלול נוכחי: Pro</p>
                <p className='text-sm text-gray-500'>סטטוס: פעיל</p>
              </div>
              <a
                href='#packages'
                className='flex items-center min-w-fit justify-center font-medium rounded-md h-10 px-4 bg-solid text-white hover:bg-solid/85'
              >
                בחר מסלול להמשך
              </a>
            </>
          ) : (
            <>
              <div>
                <p className='text-lg font-semibold'>תוכנית: Free</p>
                <p className='text-sm text-gray-500'>סטטוס: לא פעיל</p>
              </div>
              <UpgradeBtn />
            </>
          )}
        </div>
      )}

      {usage && <SubscriptionUsage usage={usage} />}

      <BillingHistory charges={charges} />

      {!isPro && (
        <>
          <h2 id='packages' className='text-xl font-bold mt-12 scroll-mt-6'>
            חבילות
          </h2>
          <Packages plan={plan} annualAvailable={isAnnualLinkConfigured()} trialActive={trialActive} />
        </>
      )}

      <div className='mt-10 flex max-w-3xl items-center gap-2.5 text-xs text-gray-500'>
        <Icon name='lock' type='reg' className='size-3.5 shrink-0 bg-gray-400' />
        התשלומים מעובדים באופן מאובטח דרך ספק הסליקה שלנו. פרטי הכרטיס אינם נשמרים אצלנו.
      </div>
    </div>
  )
}
