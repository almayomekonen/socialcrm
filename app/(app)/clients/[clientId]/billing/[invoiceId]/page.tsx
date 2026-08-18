import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import {
  getInvoiceById,
  getInvoiceLinesByInvoiceId,
} from '@/db/billing/invoices'
import { getActiveBillingProfileForLead } from '@/db/billing/profiles'
import { getCurrentDocumentForInvoice } from '@/db/billing/documents'
import { canIssueBilling } from '@/lib/billing/permissions'
import type { BusinessType } from '@/lib/billing/issuer/fields'
import InvoiceDraftEditor from '@/components/billing/InvoiceDraftEditor'
import InvoiceFrozenView from '@/components/billing/InvoiceFrozenView'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'

export const maxDuration = 60
export const preferredRegion = 'arn1'

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; invoiceId: string }>
}) {
  const { clientId, invoiceId } = await params
  const leadId = Number(clientId)
  const invId = Number(invoiceId)
  if (!Number.isFinite(leadId) || !Number.isFinite(invId)) redirect(`/clients/${clientId}/billing`)

  const user = await requireUser()

  /**
   * DESKTOP-ONLY LEAD TAB. After authentication, before the lead-access and
   * invoice reads. The draft editor and the frozen document view are both
   * desktop surfaces; no billing rule or query is changed.
   */
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='lead_billing' />

  const { gotPermIds } = await getPerms(user)
  const leadAccessQ = db('clients').where({ id: leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadAccessQ.whereIn('userId', gotPermIds)
  const leadRow = await leadAccessQ.first('id')
  if (!leadRow) return <NotFound leadId={leadId} />

  const invoice = await getInvoiceById(invId)
  if (!invoice || invoice.leadId !== leadId) {
    return <NotFound leadId={leadId} />
  }

  const lines = await getInvoiceLinesByInvoiceId(invId)

  if (invoice.docState !== 'draft') {
    const document = await getCurrentDocumentForInvoice(invId)
    return <InvoiceFrozenView invoice={invoice} lines={lines} document={document} />
  }

  const profile = await getActiveBillingProfileForLead(leadId)

  const agencyRow = await db('agencies').where({ id: user.agencyId }).first('businessType')
  const agencyBusinessType = (agencyRow?.businessType ?? null) as BusinessType | null

  return (
    <InvoiceDraftEditor
      invoice={invoice}
      lines={lines}
      profile={profile}
      canIssue={canIssueBilling(user)}
      agencyBusinessType={agencyBusinessType}
    />
  )
}

function NotFound({ leadId }: { leadId: number }) {
  return (
    <div className='py-12 text-center text-gray-500'>
      <p className='text-base mb-2'>החשבונית לא נמצאה</p>
      <Link href={`/clients/${leadId}/billing` as any} className='text-solid underline'>
        חזרה לרשימת החשבוניות
      </Link>
    </div>
  )
}
