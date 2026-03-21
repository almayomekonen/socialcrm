import { getUser } from '@/db/auth'
import { getLeadLists, getLeadsTable } from '@/db/clients'
import { Metadata } from 'next'
import ClientsTable from '@/components/clients/clientsTable'
import { Provider } from '@/lib/hooksNEvents'
import { getPerms } from '@/db/filter'
import { getUsers } from '@/db/usersNTeams'

export const metadata: Metadata = {
  title: 'נתוני לידים',
  description: 'כל נתוני הלידים',
}

export default async function ClientsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const user = await getUser()
  const handlers = await getPerms(user)
  const users = await getUsers({ withOfficeUsers: false, withExtUsers: false })
  const clients = await getLeadsTable({ user, params, gotPermIds: handlers.gotPermIds })
  const clientLists = await getLeadLists(user.id)

  return (
    <Provider
      props={{
        tableLength: clients.length,
        params,
        clientLists,
        clients,
        handlers: handlers.allPermUsers,
        users,
      }}
      className='mb-8'
    >
      <h1 className='title mb-2'>לידים</h1>

      <ClientsTable data={clients} user={user} key={Math.random()} />
    </Provider>
  )
}
