import { getUser } from '@/db/auth'
import { redirect } from 'next/navigation'
import { Metadata } from 'next'
import { isAdmin } from '@/types/roles'
import { getPerms } from '@/db/filter'
import { getLeadStats, getPipelineLeads, getLeadLists } from '@/db/clients'
import { Provider } from '@/lib/hooksNEvents'
import ClientsTable from '@/components/clients/clientsTable'

export const metadata: Metadata = {
  title: 'פיפליין',
  description: 'לידים פעילים',
}

export default async function PipelinePage({ searchParams }) {
  const params = (await searchParams) || {}
  const user = await getUser()
  if (!user) redirect('/auth')

  const handlers = await getPerms(user)

  const [stats, leads, clientLists] = await Promise.all([
    getLeadStats(),
    getPipelineLeads({ gotPermIds: handlers.gotPermIds, isAdminUser: isAdmin(user.role) }),
    getLeadLists(user.id),
  ])

  return (
    <Provider
      className='mb-8'
      props={{
        tableLength: leads.length,
        params,
        clientLists,
        clients: leads,
        handlers: handlers.allPermUsers,
      }}
    >
      <div className='flex gap-4 mobile:grid grid-cols-2 mb-6'>
        <div className='num-box'>
          <span>לידים חדשים</span>
          <h2>{stats.newLeads}</h2>
        </div>
        <div className='num-box'>
          <span>בתהליך</span>
          <h2>{stats.inProgress}</h2>
        </div>
        <div className='num-box'>
          <span>סגרו החודש</span>
          <h2>{stats.closedThisMonth}</h2>
        </div>
      </div>

      <h1 className='title mb-2'>פיפליין</h1>
      <ClientsTable leads={true} data={leads.map((l, i) => ({ ...l, _priority: i + 1 }))} user={user} compact={true} />
    </Provider>
  )
}
