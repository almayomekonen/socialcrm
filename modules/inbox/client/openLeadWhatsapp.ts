'use client'

import { toast } from '@/lib/toast'
import { resolveLeadWhatsappConversation } from '@/modules/inbox/actions'

/**
 * Canonical in-app Lead → WhatsApp navigation.
 * Resolves/ensures an Inbox conversation, then opens `/inbox?conversation=<id>`.
 * Never opens external WhatsApp (wa.me) itself.
 *
 * `onUnavailable` is OPTIONAL and additive. Without it the behaviour is exactly
 * what it always was: a toast explaining why the conversation could not be
 * opened. With it, the caller takes over for the recoverable cases — which is
 * what lets the mobile lead list keep a working WhatsApp action when the
 * workspace has no WhatsApp connection, instead of a control that only ever
 * apologises. Desktop callers pass nothing and are untouched.
 */
export async function openLeadWhatsappInInbox(
  leadId: number,
  push: (href: string) => void,
  opts?: { onUnavailable?: (reason: string) => void },
): Promise<void> {
  const { conversationId, reason } = await resolveLeadWhatsappConversation(leadId)
  if (conversationId) {
    push(`/inbox?conversation=${conversationId}`)
    return
  }

  if (opts?.onUnavailable) {
    opts.onUnavailable(reason ?? 'unknown')
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
