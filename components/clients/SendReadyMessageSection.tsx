import 'server-only'
import { getUser } from '@/db/auth'
import { isTemplatesEnabledForAgency } from '@/lib/whatsapp/templates/flag'
import { listTemplates } from '@/db/whatsappTemplates'
import { resolveWhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'
import SendReadyMessage from './SendReadyMessage'

/**
 * Server gate for the lead-profile "send ready message" affordance (Sprint 6).
 *
 * Renders NOTHING unless all are true, so the surface is invisible until it can
 * actually work (no dead-end button):
 *   1. the feature flag is on for the agency,
 *   2. the agency has at least one APPROVED template,
 *   3. this lead is WhatsApp-reachable (a connection + a usable number).
 *
 * The connection token resolved for the reachability check stays on the server —
 * only the token-free approved `Template[]` and the leadId cross to the client.
 */
export default async function SendReadyMessageSection({ leadId }: { leadId: number }) {
  const user = await getUser()
  const agencyId = user?.agencyId
  if (typeof agencyId !== 'number') return null
  if (!isTemplatesEnabledForAgency(agencyId)) return null

  const approved = (await listTemplates(agencyId)).filter((t) => t.status === 'approved')
  if (approved.length === 0) return null

  const reachable = await resolveWhatsappOutboundTarget(agencyId, leadId)
  if (reachable.ok === false) return null

  return (
    <div className='mb-8 flex justify-end'>
      <SendReadyMessage leadId={leadId} templates={approved} />
    </div>
  )
}
