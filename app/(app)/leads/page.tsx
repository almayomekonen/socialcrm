import { getUser } from '@/db/auth'
import { getClientLists, getClientsTable } from '@/db/clients'
import { Metadata } from 'next'
import ClientsTable from '@/components/clients/clientsTable'
import { Provider } from '@/lib/hooksNEvents'
import { getPerms } from '@/db/filter'

export const metadata: Metadata = {
  title: 'נתוני לידים',
  description: 'כל נתוני הלידים',
}

export default async function LeadsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const user = await getUser()
  const handlers = await getPerms(user)
  const clients = await getClientsTable({ user, params, leads: true, gotPermIds: handlers.gotPermIds })
  const clientLists = await getClientLists(user.id)
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

      <ClientsTable leads={true} data={clients} user={user} key={Math.random()} />
    </Provider>
  )
}
