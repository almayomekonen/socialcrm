import { Suspense } from 'react'
import { after } from 'next/server'
import Activity from '@/components/summary/Activity'
import Tasks from '@/components/summary/Tasks'
import { get5TasksByClientId } from '@/db/tasks'
import { getFullLead } from '@/db/clients'
import { getUser } from '@/db/auth'
import LeadIntelligenceCard from '@/components/ai/LeadIntelligenceCard'
import LeadIntelligenceCardSkeleton from '@/components/ai/LeadIntelligenceCardSkeleton'
import SendReadyMessageSection from '@/components/clients/SendReadyMessageSection'
import FollowUpControl from '@/components/leads/FollowUpControl'
import OutcomeControl from '@/components/leads/OutcomeControl'
import FirstLeadCallout from '@/components/clients/FirstLeadCallout'
import InboundLeadContext from '@/components/clients/InboundLeadContext'
import { STATUS_STYLES } from '@/lib/leads/statusStyles'
import { outcomeLabel } from '@/lib/leads/outcomeRules'
import { formatDate } from '@/lib/dates'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import { getMobileLeadDetail } from '@/modules/leads/queries'
import LeadDetailMobile from '@/modules/leads/mobile/LeadDetailMobile'
import { track } from '@/lib/analytics/track'

export default async function page({ params }) {
  const { clientId } = await params
  const user = await getUser()

  /**
   * MOBILE LEAD DETAIL (Phase A). Returned BEFORE the desktop queries so a phone
   * never receives ClientHeader, the four-tab nav, the inbox CTA, or the
   * tasks/activity grid. Same `getFullLead` read underneath (`getMobileLeadDetail`).
   */
  if ((await isMobileRequest()) && canEnterMobileWorkspace(user?.agencyId)) {
    const lead = await getMobileLeadDetail(Number(clientId))
    if (!lead) return <div className='px-4 py-14 text-center text-gray-500'>ליד זה לא נמצא</div>
    after(() =>
      track({
        agencyId: user.agencyId,
        userId: user.id,
        event: 'mobile_lead_opened',
        props: { leadId: Number(clientId) },
      }),
    )
    return <LeadDetailMobile lead={lead} nowMs={Date.now()} />
  }

  const [tasks, lead] = await Promise.all([
    get5TasksByClientId(clientId),
    getFullLead({
      id: Number(clientId),
      select: ['status', 'nextFollowUpAt', 'followUpNote', 'lastOutcomeType', 'lastActivityAt', 'leadSource', 'createdAt', 'firstName', 'lastName', 'phone', 'email'],
    }),
  ])
  const nextFollowUpAt = lead?.nextFollowUpAt ?? null
  const lastOutcome = outcomeLabel(lead?.lastOutcomeType)
  const statusStyle = lead?.status ? STATUS_STYLES[lead.status] : null
  return (
    <div>
      {/* "This lead arrived automatically" context — shown only for genuine
          webhook-ingested (whatsapp:/facebook:) leads. Independent of the
          manual-first-lead FirstLeadCallout below (they never co-occur). */}
      <Suspense fallback={null}>
        <InboundLeadContext
          leadId={Number(clientId)}
          leadSource={lead?.leadSource ?? null}
          createdAt={lead?.createdAt ?? null}
          firstName={lead?.firstName ?? null}
          lastName={lead?.lastName ?? null}
          phone={lead?.phone ?? null}
          email={lead?.email ?? null}
        />
      </Suspense>
      <Suspense fallback={null}>
        <FirstLeadCallout leadId={Number(clientId)} hasFollowUp={!!nextFollowUpAt}>
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
        </FirstLeadCallout>
      </Suspense>
      <Suspense fallback={null}>
        <SendReadyMessageSection leadId={Number(clientId)} />
      </Suspense>
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
