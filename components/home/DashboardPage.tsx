import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUser } from '@/db/auth'
import { getPerms } from '@/db/filter'
import { getDefaultSettings } from '@/db/usersNTeams'
import { getLeadsTable } from '@/db/clients'
import LeadQuickActions from '@/components/home/LeadQuickActions'

type Row = {
  id: number
  name: string
  phone: string | null
  status: string
  state: 'cold' | 'updated' | null
  slaRemainingHours: number | null
  nextAction: string | null
  leadSource: string | null
}

function bucket(rows: Row[]) {
  const overdue: Row[] = []
  const today: Row[] = []
  const fresh: Row[] = []

  for (const r of rows) {
    if (r.status === 'closed' || r.status === 'lost') continue
    if (r.state === 'cold') overdue.push(r)
    else if (r.slaRemainingHours != null && r.slaRemainingHours <= 24) today.push(r)
    else if (r.status === 'new') fresh.push(r)
  }
  return { overdue: overdue.slice(0, 5), today: today.slice(0, 5), fresh: fresh.slice(0, 5) }
}

function Card({ title, subtitle, rows, emptyMsg }: { title: string; subtitle: string; rows: Row[]; emptyMsg: string }) {
  return (
    <div className='bg-white px-5 py-4 rounded-lg border border-gray-200'>
      <div className='flex items-baseline justify-between mb-3'>
        <div>
          <h2 className='text-base font-semibold'>{title}</h2>
          <p className='text-xs text-gray-500'>{subtitle}</p>
        </div>
        <span className='text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600'>{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <p className='text-sm text-gray-500 py-4'>{emptyMsg}</p>
      ) : (
        <ul className='divide-y divide-gray-100'>
          {rows.map((r) => (
            <li key={r.id} className='py-2 flex items-center justify-between gap-3'>
              <div className='min-w-0'>
                <Link href={`/clients/${r.id}/summary`} className='block font-semibold truncate underline'>
                  {r.name || '—'}
                </Link>
                <p className='text-xs text-gray-500 truncate'>
                  {r.phone || 'ללא טלפון'}
                  {r.nextAction ? ` · ${r.nextAction}` : ''}
                </p>
              </div>
              <LeadQuickActions id={r.id} phone={r.phone} status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default async function DashboardPage() {
  const user = await getUser()
  const [handlers, settings] = await Promise.all([getPerms(user), getDefaultSettings(user.id)])
  const rows: Row[] = await getLeadsTable({
    user,
    params: { tableLimit: 100 },
    leads: true,
    gotPermIds: handlers.gotPermIds,
    settings,
  })

  if (!rows || rows.length === 0) redirect('/leads')

  const { overdue, today, fresh } = bucket(rows)

  return (
    <div className='mb-8'>
      <h1 className='title mb-1'>היום</h1>
      <p className='text-sm text-gray-500 mb-4'>ממה כדאי להתחיל עכשיו</p>

      <div className='grid grid-cols-1 desktop:grid-cols-3 gap-4'>
        <Card
          title='דורש טיפול'
          subtitle='חרגו מזמן תגובה'
          rows={overdue}
          emptyMsg='אין לידים באיחור'
        />
        <Card
          title='היום'
          subtitle='לפנות ב־24 השעות הקרובות'
          rows={today}
          emptyMsg='אין לידים דחופים להיום'
        />
        <Card
          title='חדשים'
          subtitle='לידים שטרם נפתחו'
          rows={fresh}
          emptyMsg='אין לידים חדשים'
        />
      </div>
    </div>
  )
}
