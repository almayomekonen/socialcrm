import { getUser } from '@/db/auth'
import { getLeadLists, getLeadsTable } from '@/db/clients'
import { Metadata } from 'next'
import ClientsTable from '@/components/clients/clientsTable'
import { Provider } from '@/lib/hooksNEvents'
import { getPerms } from '@/db/filter'
import { getDefaultSettings } from '@/db/usersNTeams'

export const metadata: Metadata = {
  title: 'נתוני לידים',
  description: 'כל נתוני הלידים',
}

export default async function LeadsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const user = await getUser()
  const [handlers, settings, clientLists] = await Promise.all([
    getPerms(user),
    getDefaultSettings(user.id),
    getLeadLists(user.id),
  ])
  const clients = await getLeadsTable({ user, params, leads: true, gotPermIds: handlers.gotPermIds, settings })
  return (
    <Provider
      props={{
        tableLength: clients.length,
        params,
        clientLists,
        clients,
        handlers: handlers.allPermUsers,
      }}
      className='mb-8'
    >
      <h1 className='title mb-2'>לידים</h1>

      <ClientsTable leads={true} data={clients} user={user} key={params.clientId ?? 'all'} />
    </Provider>
  )
}
