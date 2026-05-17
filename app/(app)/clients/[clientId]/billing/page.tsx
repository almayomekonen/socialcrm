import { notFound } from 'next/navigation'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { listInvoicesForLead } from '@/db/billing/invoices'
import { canDraftBilling } from '@/lib/billing/permissions'
import LeadBillingList from '@/components/billing/LeadBillingList'

export default async function LeadBillingPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const leadId = Number(clientId)
  if (!Number.isFinite(leadId)) return null

  const user = await requireUser()

  const { gotPermIds } = await getPerms(user)
  const leadAccessQ = db('clients').where({ id: leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadAccessQ.whereIn('userId', gotPermIds)
  const lead = await leadAccessQ.first('id')
  if (!lead) notFound()

  const invoices = await listInvoicesForLead(leadId)

  return <LeadBillingList leadId={leadId} invoices={invoices} canCreate={canDraftBilling(user)} />
}
