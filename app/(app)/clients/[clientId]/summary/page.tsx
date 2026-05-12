import { Suspense } from 'react'
import Activity from '@/components/summary/Activity'
import Tasks from '@/components/summary/Tasks'
import { get5TasksByClientId } from '@/db/tasks'
import LeadIntelligenceCard from '@/components/ai/LeadIntelligenceCard'
import LeadIntelligenceCardSkeleton from '@/components/ai/LeadIntelligenceCardSkeleton'

export default async function page({ params }) {
  const { clientId } = await params

  const tasks = await get5TasksByClientId(clientId)
  return (
    <div>
      <Suspense fallback={<LeadIntelligenceCardSkeleton />}>
        <LeadIntelligenceCard leadId={clientId} />
      </Suspense>
      <div className='grid xl:grid-cols-2 gap-8'>
        <Tasks tasks={tasks} clientId={clientId} />
        <Activity clientId={clientId} />
      </div>
    </div>
  )
}
