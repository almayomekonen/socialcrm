import { getGoalsAndTotals, getSaleStats } from '@/db/sumSales'
import { getPromos, getPromosByUserId } from '@/db/promos'
import { getPermsAndFilter } from '@/db/filter'
import { formatCurrency } from '@/lib/funcs'
import { isAdmin } from '@/types/roles'
import Link from 'next/link'

export default async function DashboardSummary({ user }) {
  const { sqlFilter, gotPermIds } = await getPermsAndFilter({ user, filter: undefined })

  const [stats, goalsAndTotals, allPromos] = await Promise.all([
    getSaleStats(sqlFilter),
    getGoalsAndTotals(user.id),
    isAdmin(user.role) ? getPromos() : getPromosByUserId(user.id, gotPermIds),
  ])

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const activePromos = allPromos.filter((p) => new Date(p.end) >= today)

  const monthlyRevenue = Object.entries(goalsAndTotals.monthly_totals)
    .filter(([key]) => key !== 'משוקלל')
    .reduce((sum, [, val]) => sum + Number(val), 0)

  return (
    <div className='mb-6'>
      <div className='flex gap-4 mobile:grid grid-cols-2 mb-6'>
        <StatCard title='הכנסות החודש' value={formatCurrency(monthlyRevenue)} />
        <StatCard title='סה"כ עסקאות' value={stats.prdctsCount ?? 0} />
        <StatCard title='לקוחות פעילים' value={stats.clientsWithSales ?? 0} />
        <StatCard title='קמפיינים פעילים' value={activePromos.length} href='/promotion' />
      </div>

    </div>
  )
}

function StatCard({ title, value, href = null }: { title: string; value: string | number; href?: string | null }) {
  const card = (
    <div className='num-box'>
      <span>{title}</span>
      <h2>{value}</h2>
    </div>
  )

  if (href) return <Link href={href}>{card}</Link>
  return card
}
