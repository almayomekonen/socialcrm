import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getUsers } from '@/db/usersNTeams'
import SumSalesNav from '@/components/sumSales/SumSalesNav'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ביצועים',
  description: 'ביצועי עסקאות',
}

export default async function SumSalesLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  let showAgents = false
  try {
    const users = await getUsers()
    showAgents = Array.isArray(users) && users.length > 1
  } catch {
    showAgents = false
  }

  return (
    <div>
      <Suspense fallback={null}>
        <SumSalesNav user={user} showAgents={showAgents} />
      </Suspense>
      {children}
    </div>
  )
}
