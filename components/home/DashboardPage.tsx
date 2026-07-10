import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'

// BISECT: entire DashboardPage content disabled (no RecommendedLeads / FollowupsTable / QuickLinks).
export default async function DashboardPage() {
  const user = await getUser()
  if (!user) redirect('/auth')

  return <div className='mb-8 grid gap-4'>bisect</div>
}
