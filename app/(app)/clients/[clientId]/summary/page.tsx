import { Suspense } from 'react'
import Activity from '@/components/summary/Activity'
import Tasks from '@/components/summary/Tasks'
import { get5TasksByClientId } from '@/db/tasks'
import { getFullLead } from '@/db/clients'
import LeadIntelligenceCard from '@/components/ai/LeadIntelligenceCard'
import LeadIntelligenceCardSkeleton from '@/components/ai/LeadIntelligenceCardSkeleton'
import FollowUpControl from '@/components/leads/FollowUpControl'
import OutcomeControl from '@/components/leads/OutcomeControl'
import { STATUS_STYLES } from '@/components/clients/LeadStatusCell'
import { outcomeLabel } from '@/lib/leads/outcomeRules'
import { formatDate } from '@/lib/dates'

export default async function page({ params }) {
  const { clientId } = await params

  const [tasks, lead] = await Promise.all([
    get5TasksByClientId(clientId),
    getFullLead({ id: Number(clientId), select: ['status', 'nextFollowUpAt', 'followUpNote', 'lastOutcomeType', 'lastActivityAt'] }),
  ])
  const nextFollowUpAt = lead?.nextFollowUpAt ?? null
  const lastOutcome = outcomeLabel(lead?.lastOutcomeType)
  const statusStyle = lead?.status ? STATUS_STYLES[lead.status] : null
  return (
    <div>
      <div className='rounded-lg border border-gray-200 bg-white p-5 mb-8'>
        <div className='flex items-center justify-between gap-3'>
          {statusStyle ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
            >
              <span className={`size-1.5 rounded-full ${statusStyle.dot}`} />
              {statusStyle.label}
            </span>
          ) : (
            <span />
          )}
          <FollowUpControl leadId={Number(clientId)} current={nextFollowUpAt} />
        </div>
        <p className='text-sm text-gray-800 truncate tabular-nums mt-2'>
          {nextFollowUpAt ? `מעקב הבא: ${formatDate(nextFollowUpAt)}` : 'לא נקבע מעקב'}
          {lead?.followUpNote ? ` · ${lead.followUpNote}` : ''}
        </p>
        {lastOutcome && (
          <p className='text-xs text-gray-500 truncate tabular-nums mt-0.5'>
            אינטראקציה אחרונה: {lastOutcome}
            {lead?.lastActivityAt ? ` · ${formatDate(lead.lastActivityAt)}` : ''}
          </p>
        )}
        <div className='mt-3 pt-3 border-t border-gray-100'>
          <OutcomeControl leadId={Number(clientId)} />
        </div>
      </div>
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
