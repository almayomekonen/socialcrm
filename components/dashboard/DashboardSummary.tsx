import { getGoalsAndTotals, getSaleStats } from '@/db/sumSales'
import { getPermsAndFilter } from '@/db/filter'
import { formatCurrency } from '@/lib/funcs'
import Link from 'next/link'

export default async function DashboardSummary({ user }) {
  const { sqlFilter } = await getPermsAndFilter({ user, filter: undefined })

  const [stats, goalsAndTotals] = await Promise.all([
    getSaleStats(sqlFilter),
    getGoalsAndTotals(user.id),
  ])

  const monthlyTotals = goalsAndTotals?.monthly_totals ?? {}
  const monthlyRevenue = Object.entries(monthlyTotals)
    .filter(([key]) => key !== 'משוקלל')
    .reduce((sum, [, val]) => sum + Number(val), 0)

  return (
    <div className='mb-6'>
      <div className='flex gap-4 mobile:grid grid-cols-2 mb-6'>
        <StatCard title='הכנסות החודש' value={formatCurrency(monthlyRevenue)} />
        <StatCard title='סה"כ עסקאות' value={stats?.prdctsCount ?? 0} />
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
