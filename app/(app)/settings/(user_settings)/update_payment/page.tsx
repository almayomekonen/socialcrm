import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { getAgencyPlan } from '@/lib/quota'
import { getSubscriptionView } from '@/lib/quota/subscription'
import AccordionItem from '@/lib/AccordionItem'
import Packages from '@/components/settings/payment/Packages'
import UpgradeBtn from '@/components/settings/payment/UpgradeBtn'
import ProPlanCard from '@/components/settings/payment/ProPlanCard'
import TrialStatusCard from '@/components/trial/TrialStatusCard'
import Icon from '@/lib/Icon'
import { formatDate } from '@/lib/dates'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'

type SearchParams = Promise<{ mode?: string | string[] }>

export default async function page({ searchParams }: { searchParams?: SearchParams }) {
  const sp = searchParams ? await searchParams : {}
  const isLocalMode = sp.mode === 'local'

  const user = await getUser()
  const plan = await getAgencyPlan(user.agencyId)
  const isPro = plan === 'pro'
  const subscription = isPro ? await getSubscriptionView(user.agencyId) : null

  // Trial lifecycle for the status card. Only TRIAL_ACTIVE can render here:
  // expired users are intercepted by the layout gate, pre-activation users
  // are behind the welcome modal, legacy/pro derive LEGACY/PAID.
  const trialRow = isPro ? null : await getAgencyTrial(user.agencyId)
  const trial = trialRow ? getTrialState(trialRow, new Date()) : null
  const trialActive = trial?.status === 'TRIAL_ACTIVE'

  const charges = await db('payments')
    .where({ agencyId: user.agencyId })
    .orderBy('createdAt', 'desc')
    .select('id', 'transactionId', 'createdAt')

  return (
    <div>
      <h1 className='title'>פרטי חבילה ותשלום</h1>

      {isLocalMode && (
        <div
          role='status'
          dir='rtl'
          className='my-6 max-w-3xl p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3'
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

      <div className='my-6 max-w-3xl p-6 bg-white rounded-lg border border-gray-200 flex items-center justify-between gap-4'>
        {isPro && subscription ? (
          <ProPlanCard subscription={subscription} />
        ) : (
          <>
            <div>
              <p className='text-lg font-semibold'>תוכנית: Free</p>
              <p className='text-sm text-gray-500'>סטטוס: {trialActive ? 'תקופת ניסיון פעילה' : 'לא פעיל'}</p>
            </div>
            <UpgradeBtn />
          </>
        )}
      </div>

      <h2 className='text-xl font-bold mt-12'>היסטוריית חיובים</h2>
      <div className='my-6 max-w-3xl'>
        <AccordionItem bodyClass='p-6' title='צפייה בחיובים'>
          {charges.length === 0 ? (
            <p className='text-sm text-gray-500'>אין נתוני חיובים עדיין</p>
          ) : (
            <ul className='divide-y divide-gray-100'>
              {charges.map((c: any) => (
                <li key={c.id} className='py-2 flex items-baseline justify-between gap-3'>
                  <span className='text-sm font-mono break-all'>{c.transactionId}</span>
                  <span className='text-xs text-gray-500 whitespace-nowrap'>{formatDate(c.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </AccordionItem>
      </div>

      <h2 className='text-xl font-bold mt-12'>חבילות</h2>
      <Packages plan={plan} />
    </div>
  )
}
