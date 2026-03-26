import { getUser } from '@/db/auth'
import { getLeadLists, getLeadsTable } from '@/db/clients'
import { Metadata } from 'next'
import ClientsTable from '@/components/clients/clientsTable'
import { Provider } from '@/lib/hooksNEvents'
import { getPerms } from '@/db/filter'
import LeadsTabs from './LeadsTabs'

export const metadata: Metadata = {
  title: 'נתוני לידים',
  description: 'כל נתוני הלידים',
}

export default async function LeadsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const closed = params.closed === 'true'
  const user = await getUser()
  const handlers = await getPerms(user)
  const clients = await getLeadsTable({ user, params, leads: !closed, gotPermIds: handlers.gotPermIds })
  const clientLists = await getLeadLists(user.id)
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
      <div className='flex items-center justify-between mb-2'>
        <h1 className='title'>{closed ? 'סגורים' : 'לידים'}</h1>
        <LeadsTabs />
      </div>

      <ClientsTable leads={!closed} data={clients} user={user} key={String(closed)} />
    </Provider>
  )
}
