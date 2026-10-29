import { notFound } from 'next/navigation'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { listInvoicesForLead } from '@/db/billing/invoices'
import { canDraftBilling } from '@/lib/billing/permissions'
import LeadBillingList from '@/components/billing/LeadBillingList'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { Metadata } from 'next'
import { getUser } from '@/db/auth'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'

/** Tab title in the interface language — Hebrew ('נתוני ליד', the lead layout's title) outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('leadDetail.page.title'), description: t('leadDetail.page.description') }
}

export default async function LeadBillingPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const leadId = Number(clientId)
  if (!Number.isFinite(leadId)) return null

  const user = await requireUser()

  /**
   * DESKTOP-ONLY LEAD TAB. Placed AFTER `requireUser()` — device class never
   * precedes authentication — and before the lead-access read below. No billing
   * logic, permission rule or query is altered; a phone simply renders the
   * handoff, which carries no lead data at all.
   */
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='lead_billing' />

  const { gotPermIds } = await getPerms(user)
  const leadAccessQ = db('clients').where({ id: leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadAccessQ.whereIn('userId', gotPermIds)
  const lead = await leadAccessQ.first('id')
  if (!lead) notFound()

  const invoices = await listInvoicesForLead(leadId)
  // Resolved once by the same request-memoised call the (app) layout makes; the list's root declares it.
  const { locale } = await getUiLocaleState(user)

  return <LeadBillingList leadId={leadId} invoices={invoices} canCreate={canDraftBilling(user)} locale={locale} />
}
