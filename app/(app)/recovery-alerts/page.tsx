import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { getRecoveryAlerts } from '@/db/recoveryAlerts'
import RecoveryAlertsTable from '@/components/recoveryAlerts/RecoveryAlertsTable'

export const metadata: Metadata = { title: 'התראות שחזור' }

export default async function RecoveryAlertsPage() {
  const user = await requireAgencyUser()
  const perms = await getPerms(user)
  const alerts = await getRecoveryAlerts(user.agencyId, user.role, perms.gotPermIds, { status: 'open' })

  return (
    <div className='p-5'>
      <h1 className='title'>התראות שחזור</h1>
      <RecoveryAlertsTable alerts={alerts} />
    </div>
  )
}
