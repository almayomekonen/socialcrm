import { redirect } from 'next/navigation'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { canDraftBilling, canIssueBilling } from '@/lib/billing/permissions'
import { getActiveBillingProfileForLead } from '@/db/billing/profiles'
import { getOrCreateDefaultTaxRate, resolveActiveTaxRateForLine } from '@/db/billing/taxRates'
import InvoiceNewEditor from '@/components/billing/InvoiceNewEditor'
import type { DocumentKind } from '@/db/billing/invoices'

export const maxDuration = 60

export const preferredRegion = 'arn1'

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { clientId } = await params
  const sp = searchParams ? await searchParams : {}
  const rawKind = typeof sp.kind === 'string' ? sp.kind : ''
  const initialKind: DocumentKind = rawKind === 'invoice_receipt' ? 'invoice_receipt' : 'invoice'
  const leadId = Number(clientId)
  if (!Number.isFinite(leadId)) redirect(`/clients/${clientId}/billing` as any)

  const user = await requireUser()
  if (!canDraftBilling(user)) redirect(`/clients/${leadId}/billing` as any)

  const { gotPermIds } = await getPerms(user)
  const leadQ = db('clients').where({ id: leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadQ.whereIn('userId', gotPermIds)
  const lead = await leadQ.first('id', 'name')
  if (!lead) redirect(`/clients/${leadId}/billing` as any)

  const profile = await getActiveBillingProfileForLead(leadId)
  // Seed the agency's default VAT row if missing. Without this, client and
  // server fall back differently and totals diverge.
  await getOrCreateDefaultTaxRate()
  // EFFECTIVE rate after applying the business-type policy (W6).
  // `getOrCreateDefaultTaxRate` would return the raw 18% VAT_STD row even
  // for an exempt agency; that previous behaviour was the bug that left
  // exempt drafts previewing 18%. `resolveActiveTaxRateForLine` reads
  // agencies.businessType and runs it through `effectiveTaxRatePercent`,
  // so an exempt agency gets 0% all the way down to the editor.
  const effectiveTaxRate = await resolveActiveTaxRateForLine(user.agencyId)
  console.log(
    '[w6.trace] new-page.resolve',
    JSON.stringify({ agencyId: user.agencyId, effectiveRatePercent: effectiveTaxRate.ratePercent, taxRateId: effectiveTaxRate.id }),
  )

  const billedLeadsQ = db('clients as c')
    .innerJoin('bill_invoices as i', 'i.leadId', 'c.id')
    .where('c.agencyId', user.agencyId)
    .where('i.agencyId', user.agencyId)
  if (!isAdmin(user.role)) billedLeadsQ.whereIn('c.userId', gotPermIds)
  const billedLeadsRaw = await billedLeadsQ
    .groupBy('c.id', 'c.details', 'c.firstName', 'c.lastName', 'c.idNum')
    .select('c.id', 'c.details', 'c.firstName', 'c.lastName', 'c.idNum')
    .max({ lastInvoiceAt: 'i.createdAt' })
    .count({ invoiceCount: 'i.id' })
    .orderBy('lastInvoiceAt', 'desc')
    .limit(50)

  const billedLeads = billedLeadsRaw.map((r: any) => ({
    id: r.id as number,
    details: r.details as string | null,
    firstName: r.firstName as string | null,
    lastName: r.lastName as string | null,
    idNum: r.idNum as string | null,
    invoiceCount: Number(r.invoiceCount) || 0,
  }))

  let recentLeads: Array<{
    id: number
    details: string | null
    firstName: string | null
    lastName: string | null
    idNum: string | null
    invoiceCount: number
  }> = billedLeads
  if (billedLeads.length < 50) {
    const billedIds = billedLeads.map((l) => l.id)
    const fallbackQ = db('clients').where({ agencyId: user.agencyId, lead: true })
    if (!isAdmin(user.role)) fallbackQ.whereIn('userId', gotPermIds)
    if (billedIds.length) fallbackQ.whereNotIn('id', billedIds)
    const fallback = await fallbackQ
      .select('id', 'details', 'firstName', 'lastName', 'idNum')
      .orderBy('createdAt', 'desc')
      .limit(50 - billedLeads.length)
    recentLeads = [...billedLeads, ...fallback.map((l) => ({ ...l, invoiceCount: 0 }))]
  }

  return (
    <InvoiceNewEditor
      userId={user.id}
      leadId={leadId}
      leadName={String(lead.name ?? '')}
      profile={profile}
      defaultTaxRatePercent={effectiveTaxRate.ratePercent}
      canIssue={canIssueBilling(user)}
      recentLeads={recentLeads}
      initialKind={initialKind}
    />
  )
}
