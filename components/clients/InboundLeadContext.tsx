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
 *
 * Facebook has no conversation to link. Its evidence is the contact detail
 * CATEGORIES SocialCRM auto-captured from the ad form (name/phone/email) and the
 * capture time — read straight off the lead the summary page already fetched. No
 * Graph call, no page/campaign/ad/form lookup, no extra query.
 */

// Ingestion injects this literal when the Facebook form carried no name
// (lib/adapters/facebookLead.ts) — treat it as "no name captured", not a real one.
const FB_NAME_PLACEHOLDER = 'ליד מפייסבוק'

/**
 * SocialCRM's capture time in the business timezone (Asia/Jerusalem), pinned
 * explicitly so it is correct on Vercel's UTC runtime and deterministic. Mirrors
 * `formatDateTime` (he-IL short date+time, dots→slashes) but timezone-safe.
 */
function formatCaptureAt(date: Date | string | null | undefined): string | null {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem',
  })
    .format(d)
    .replaceAll('.', '/')
}

export default async function InboundLeadContext({
  leadId,
  leadSource,
  createdAt,
  firstName,
  lastName,
  phone,
  email,
}: {
  leadId: number
  leadSource: string | null | undefined
  createdAt?: Date | string | null
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  email?: string | null
}) {
  const channel = inboundChannelFromSource(leadSource)
  if (channel === 'facebook') {
    // Evidence = which detail categories the lead currently holds. Presence-based
    // (no per-field provenance); the ingestion name placeholder does not count.
    const hasName = !!(lastName?.trim() || (firstName?.trim() && firstName.trim() !== FB_NAME_PLACEHOLDER))
    return (
      <InboundLeadContextView
        channel='facebook'
        hasName={hasName}
        hasPhone={!!phone?.trim()}
        hasEmail={!!email?.trim()}
        capturedAt={formatCaptureAt(createdAt)}
      />
    )
  }
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
