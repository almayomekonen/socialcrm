import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { getAgencyPlan } from '@/lib/quota'
import AccordionItem from '@/lib/AccordionItem'
import Packages from '@/components/settings/payment/Packages'
import UpgradeBtn from '@/components/settings/payment/UpgradeBtn'
import { formatDate } from '@/lib/dates'

export default async function page() {
  const user = await getUser()
  const plan = await getAgencyPlan(user.agencyId)
  const isPro = plan === 'pro'

  const charges = await db('payments')
    .where({ agencyId: user.agencyId })
    .orderBy('createdAt', 'desc')
    .select('id', 'transactionId', 'createdAt')

  return (
    <div>
      <h1 className='title'>פרטי חבילה ותשלום</h1>

      <div className='my-6 max-w-3xl p-6 bg-white rounded-lg border border-gray-200 flex items-center justify-between gap-4'>
        <div>
          <p className='text-lg font-semibold'>תוכנית: {isPro ? 'Pro' : 'Free'}</p>
          <p className='text-sm text-gray-500'>סטטוס: {isPro ? 'פעיל' : 'לא פעיל'}</p>
        </div>
        {isPro ? (
          <span className='text-sm font-semibold text-green-700'>אתה במסלול Pro</span>
        ) : (
          <UpgradeBtn />
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
