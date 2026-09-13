import { Suspense } from 'react'
import { statusStyle } from '@/lib/leads/statusStyles'
import { outcomeLabel } from '@/lib/leads/outcomeRules'
import { formatDate } from '@/lib/dates'
import LeadIntelligenceCard from '@/components/ai/LeadIntelligenceCard'
import LeadIntelligenceCardSkeleton from '@/components/ai/LeadIntelligenceCardSkeleton'
import type { MobileLeadDetail } from '@/modules/leads/queries'
import { followUpBadge } from './followUpBadge'
import LeadDetailActions from './LeadDetailActions'
import LeadProvenance from './LeadProvenance'
import { startOfBusinessDayMs } from '@/lib/today/time'

/**
 * Dedicated mobile lead detail. Not a responsive desktop summary.
 *
 * Order: identity → status/follow-up → source/provenance → contact → rest →
 * sticky actions. Desktop chrome (ClientHeader, ClientNav, tasks, files,
 * billing, inbox CTA) is absent on purpose.
 */
export default function LeadDetailMobile({
  lead,
  nowMs,
  firstLead = false,
  whatsappConnected,
}: {
  lead: MobileLeadDetail
  nowMs: number
  /** Arrived straight from creating/importing the workspace's first lead. */
  firstLead?: boolean
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
}) {
  const status = statusStyle(lead.status)
  const followUp = followUpBadge(lead.nextFollowUpAt, nowMs, startOfBusinessDayMs(nowMs))
  const lastOutcome = outcomeLabel(lead.lastOutcomeType)

  return (
    <div className='flex min-h-full flex-col'>
      <div className='flex-1 px-4 pb-4 pt-4'>
        <h2 className='truncate text-xl font-bold leading-tight text-ink'>{lead.name}</h2>

        <div className='mt-3 flex flex-wrap items-center gap-1.5'>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.bg} ${status.text} ${status.border}`}
          >
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
          {followUp && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${followUp.className}`}>
              {followUp.label}
            </span>
          )}
        </div>

        <Suspense fallback={null}>
          <LeadProvenance lead={lead} />
        </Suspense>

        <ContactBlock lead={lead} />

        <section className='mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white'>
          <InfoRow label='מעקב' value={lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : 'לא נקבע'} />
          {lead.followUpNote && <InfoRow label='הערה' value={lead.followUpNote} />}
          {lastOutcome && <InfoRow label='תוצאה אחרונה' value={lastOutcome} />}
          {lead.lastActivityAt && <InfoRow label='פעילות אחרונה' value={formatDate(lead.lastActivityAt)} />}
        </section>

        <div className='mt-4'>
          <Suspense fallback={<LeadIntelligenceCardSkeleton />}>
            <LeadIntelligenceCard leadId={lead.id} />
          </Suspense>
        </div>
      </div>

      <LeadDetailActions
        leadId={lead.id}
        phone={lead.phone}
        name={lead.name}
        status={lead.status}
        nextFollowUpAt={lead.nextFollowUpAt}
        firstLead={firstLead}
        whatsappConnected={whatsappConnected}
      />
    </div>
  )
}

function ContactBlock({ lead }: { lead: MobileLeadDetail }) {
  const rows: { href: string; label: string; value: string }[] = []
  if (lead.phone) rows.push({ href: `tel:${lead.phone}`, label: 'טלפון', value: lead.phone })
  if (lead.secPhone) rows.push({ href: `tel:${lead.secPhone}`, label: 'טלפון נוסף', value: lead.secPhone })
  if (lead.email) rows.push({ href: `mailto:${lead.email}`, label: 'אימייל', value: lead.email })
  if (rows.length === 0) return null

  return (
    <section className='mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white'>
      {rows.map((r) => (
        <a
          key={r.href + r.value}
          href={r.href}
          className='flex min-h-11 items-center justify-between gap-3 border-b border-gray-100 px-4 last:border-b-0 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary'
        >
          <span className='text-[12px] text-gray-400'>{r.label}</span>
          <span className='truncate text-[14px] font-medium tabular-nums text-ink' dir='ltr'>
            {r.value}
          </span>
        </a>
      ))}
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex min-h-11 items-center justify-between gap-3 border-b border-gray-100 px-4 last:border-b-0'>
      <span className='shrink-0 text-[12px] text-gray-400'>{label}</span>
      <span className='truncate text-[14px] text-ink'>{value}</span>
    </div>
  )
}
