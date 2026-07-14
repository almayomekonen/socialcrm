'use client'

import { toast } from '@/lib/toast'
import { resolveLeadWhatsappConversation } from '@/modules/inbox/actions'

/**
 * Canonical in-app Lead → WhatsApp navigation.
 * Resolves/ensures an Inbox conversation, then opens `/inbox?conversation=<id>`.
 * Never opens external WhatsApp (wa.me).
 */
export async function openLeadWhatsappInInbox(
  leadId: number,
  push: (href: string) => void,
): Promise<void> {
  const { conversationId, reason } = await resolveLeadWhatsappConversation(leadId)
  if (conversationId) {
    push(`/inbox?conversation=${conversationId}`)
    return
  }
  if (reason === 'no-connection') {
    toast('message', 'יש לחבר WhatsApp בהגדרות לפני פתיחת שיחה')
    return
  }
  if (reason === 'no-recipient') {
    toast('message', 'לליד אין מספר טלפון תקין לשיחת WhatsApp')
    return
  }
  toast('message', 'לא ניתן לפתוח שיחת WhatsApp לליד זה כרגע')
}
