import { Suspense } from 'react'
import { leadStatusLabel, statusStyle } from '@/lib/leads/statusStyles'
import { outcomeLabel } from '@/lib/leads/outcomeRules'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'
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
  locale = 'he',
}: {
  lead: MobileLeadDetail
  nowMs: number
  /** Arrived straight from creating/importing the workspace's first lead. */
  firstLead?: boolean
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
  /** The interface language, resolved once by the page (Hebrew by default). */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const status = statusStyle(lead.status)
  // An unknown code is drawn as `new` (statusStyle), so it is worded as `new` too.
  const statusLabel = locale === 'he' ? status.label : leadStatusLabel(lead.status, locale) ?? leadStatusLabel('new', locale)
  const followUp = followUpBadge(lead.nextFollowUpAt, nowMs, startOfBusinessDayMs(nowMs), locale)
  const lastOutcome = outcomeLabel(lead.lastOutcomeType, locale)

  return (
    <div className='flex min-h-full flex-col' {...regionAttrs(locale)}>
      <div className='flex-1 px-4 pb-4 pt-4'>
        <h2 className='truncate text-xl font-bold leading-tight text-ink'>{lead.name}</h2>

        <div className='mt-3 flex flex-wrap items-center gap-1.5'>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.bg} ${status.text} ${status.border}`}
          >
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {statusLabel}
          </span>
          {followUp && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${followUp.className}`}>
              {followUp.label}
            </span>
          )}
        </div>

        <Suspense fallback={null}>
          <LeadProvenance lead={lead} locale={locale} />
        </Suspense>

        <ContactBlock lead={lead} t={t} />

        <section className='mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white'>
          <InfoRow label={t('leads.mobile.detail.followUp')} value={lead.nextFollowUpAt ? formatLeadDate(locale, lead.nextFollowUpAt) : t('leads.mobile.detail.notSet')} />
          {lead.followUpNote && <InfoRow label={t('leads.mobile.detail.note')} value={lead.followUpNote} />}
          {lastOutcome && <InfoRow label={t('leads.mobile.detail.lastOutcome')} value={lastOutcome} />}
          {lead.lastActivityAt && <InfoRow label={t('leads.mobile.detail.lastActivity')} value={formatLeadDate(locale, lead.lastActivityAt)} />}
        </section>

        <div className='mt-4'>
          <Suspense fallback={<LeadIntelligenceCardSkeleton locale={locale} />}>
            <LeadIntelligenceCard leadId={lead.id} locale={locale} />
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

function ContactBlock({ lead, t }: { lead: MobileLeadDetail; t: Translator }) {
  const rows: { href: string; label: string; value: string }[] = []
  if (lead.phone) rows.push({ href: `tel:${lead.phone}`, label: t('leads.mobile.detail.phone'), value: lead.phone })
  if (lead.secPhone) rows.push({ href: `tel:${lead.secPhone}`, label: t('leads.form.secPhone'), value: lead.secPhone })
  if (lead.email) rows.push({ href: `mailto:${lead.email}`, label: t('leads.mobile.detail.email'), value: lead.email })
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
