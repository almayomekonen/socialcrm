import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getLeadLists, getLeadsTable, getGlobalLatestUpdatedAt } from '@/db/clients'
import { Metadata } from 'next'
import ClientsTable from '@/components/clients/clientsTable'
import { Provider } from '@/lib/hooksNEvents'
import { getPerms } from '@/db/filter'
import { getDefaultSettings, getUsers } from '@/db/usersNTeams'
import { getQuotaStatus } from '@/lib/quota'
import OverQuotaBanner from '@/components/quota/OverQuotaBanner'

export const metadata: Metadata = {
  title: 'נתוני לקוחות',
  description: 'כל נתוני הלקוחות',
}

export default async function ClientsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const user = await getUser()
  const [handlers, settings, clientLists, globalLatestUpdatedAt, allUsers, quota] = await Promise.all([
    getPerms(user),
    getDefaultSettings(user.id),
    getLeadLists(user.id),
    getGlobalLatestUpdatedAt(),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
    getQuotaStatus(user.agencyId),
  ])
  const clients = await getLeadsTable({ user, params, leads: false, gotPermIds: handlers.gotPermIds, settings })
  const formProps = { user, officeGotPerm: handlers.gotPermUsers, allUsers }
  return (
    <Provider
      props={{
        tableLength: clients.length,
        params,
        clientLists,
        clients,
        handlers: handlers.allPermUsers,
        users: handlers.allPermUsers,
      }}
      className='mb-8'
    >
      <p className='text-sm text-gray-500 mb-2'>לקוחות הם לידים שסגרו עסקה</p>

      <OverQuotaBanner count={quota.overQuotaCount} />

      <Suspense fallback={null}>
        <ClientsTable leads={false} data={clients} user={user} globalLatestUpdatedAt={globalLatestUpdatedAt} formProps={formProps} key={params.clientId ?? 'all'} />
      </Suspense>
    </Provider>
  )
}
