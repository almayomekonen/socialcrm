import type { LeadIntelligenceInputs } from '@/db/aiSummaries'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import { buildLeadFollowupUserMessage } from './leadFollowup'

/**
 * User message for the WhatsApp reply draft. Reuses the lead-followup data
 * builder (lead intelligence JSON) and appends the recent WhatsApp transcript so
 * the model replies in context. The system prompt and schema are reused verbatim
 * from leadFollowup — only the user message differs.
 */
export function buildWhatsappReplyUserMessage(
  inputs: LeadIntelligenceInputs,
  leadName: string | null,
  recentMessages: LeadWhatsappMessage[],
): string {
  const base = buildLeadFollowupUserMessage(inputs, leadName)

  if (recentMessages.length === 0) {
    return `${base}\n\nאין הודעות WhatsApp קודמות עם הליד. נסח פתיח קצר בוואטסאפ.`
  }

  const transcript = recentMessages
    .map((m) => `${m.direction === 'inbound' ? 'הליד' : 'הנציג'}: ${m.text || '[הודעה ללא טקסט]'}`)
    .join('\n')

  return `${base}\n\nהודעות WhatsApp אחרונות (מהישן לחדש):\n${transcript}\n\nנסח תשובה אחת בוואטסאפ, מותאמת להודעה האחרונה של הליד ולמצב הליד. הערוץ הוא whatsapp.`
}
