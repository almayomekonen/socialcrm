import { getUser } from '@/db/auth'
import { getInboxConversationByLeadId } from '@/modules/inbox/queries'
import { listConversationMessages } from '@/db/inboxMessages'
import { inboundChannelFromSource } from '@/lib/leads/leadSourceLabel'
import { InboundLeadContextView } from './InboundLeadContextView'

/**
 * "This lead arrived automatically" context surface for the lead summary.
 *
 * Shows ONLY for genuinely auto-ingested (webhook-created) leads — the composite
 * `whatsapp:{id}` / `facebook:{id}` sources — never for manual/plain/free-text
 * sources. Presentation + existing-read only: it does not touch the webhook,
 * ingestion, dedup, or any stored value.
 *
 * WhatsApp additionally surfaces the customer's FIRST inbound message (the "how
 * this lead entered" moment) and a CTA into the existing Inbox thread, resolved
 * through the agency-scoped `getInboxConversationByLeadId`. Any inbox-read failure
 * degrades to copy-only and NEVER breaks the lead page.
 */
export default async function InboundLeadContext({
  leadId,
  leadSource,
}: {
  leadId: number
  leadSource: string | null | undefined
}) {
  const channel = inboundChannelFromSource(leadSource)
  if (channel === 'facebook') return <InboundLeadContextView channel='facebook' />
  if (channel !== 'whatsapp') return null // manual / plain / instagram / unknown → nothing

  let conversationId: number | null = null
  let preview: string | null = null
  try {
    const user = await getUser()
    if (user?.agencyId) {
      // Agency-scoped: only returns a conversation belonging to THIS agency AND
      // linked to THIS lead's WhatsApp thread.
      const conv = await getInboxConversationByLeadId(user.agencyId, leadId)
      if (conv?.conversationId) {
        conversationId = conv.conversationId
        // conv id is already agency+lead-authorized above; read its messages and
        // take the customer's first inbound text (sequence-ascending). Reuses the
        // existing helper — no new query solely for the first message.
        const messages = await listConversationMessages(conv.conversationId)
        const firstInbound = messages.find(
          (m) => m.direction === 'inbound' && typeof m.text === 'string' && m.text.trim().length > 0,
        )
        preview = firstInbound ? firstInbound.text.trim() : null
      }
    }
  } catch (err) {
    // Never break the lead page over a contextual read.
    console.error('[InboundLeadContext] inbox read failed; showing copy only', { leadId, err: String(err) })
  }

  return <InboundLeadContextView channel='whatsapp' conversationId={conversationId} preview={preview} />
}
