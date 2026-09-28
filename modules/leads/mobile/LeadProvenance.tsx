import { loadLeadFormAnswers, loadWhatsAppInboundPreview, type FormAnswerRow } from '@/lib/leads/inboundLeadContextData'
import { inboundChannelFromSource } from '@/lib/leads/leadSourceLabel'
import type { MobileLeadDetail } from '@/modules/leads/queries'
import LeadProvenanceCard from './LeadProvenanceCard'
import { buildMobileProvenanceModel } from './leadProvenanceModel'

/**
 * Server wrapper: same inbound reads desktop uses, then the mobile card.
 * Only mounted from `LeadDetailMobile` — never on the desktop summary.
 */
export default async function LeadProvenance({ lead }: { lead: MobileLeadDetail }) {
  const inbound = inboundChannelFromSource(lead.leadSource)
  let conversationId: number | null = null
  let preview: string | null = null
  if (inbound === 'whatsapp') {
    const wa = await loadWhatsAppInboundPreview(lead.id)
    conversationId = wa.conversationId
    preview = wa.preview
  }
  const formAnswers: FormAnswerRow[] =
    inbound === 'facebook' || inbound === 'instagram' ? await loadLeadFormAnswers(lead.id) : []

  const model = buildMobileProvenanceModel({
    leadSource: lead.leadSource,
    sourceLabel: lead.sourceLabel,
    sourceChannel: lead.sourceChannel,
    createdAt: lead.createdAt,
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: lead.phone,
    email: lead.email,
    conversationId,
    preview,
  })

  return <LeadProvenanceCard model={model} formAnswers={formAnswers} />
}
