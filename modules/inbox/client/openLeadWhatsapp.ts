'use client'

import { toast } from '@/lib/toast'
import { resolveLeadWhatsappConversation } from '@/modules/inbox/actions'

/**
 * Canonical in-app Lead → WhatsApp navigation.
 * Resolves/ensures an Inbox conversation, then opens `/inbox?conversation=<id>`.
 * Never opens external WhatsApp (wa.me).
 *
 * `onNoConnection` is OPTIONAL and handles EXACTLY ONE reason: the workspace has
 * no WhatsApp connected. That is the only outcome the rep can act on, so a
 * caller may route them to the connect UI instead of explaining it in a toast.
 * Every other reason is a property of the lead (no valid number, lead missing)
 * and gets the same explanation on every surface — a caller cannot reinterpret
 * those.
 *
 * The hook used to be a general `onUnavailable(reason)`, which let the mobile
 * caller answer ANY failure with `window.open(wa.me)`. That ejected the rep out
 * of SocialCRM, and — because `window.open` ran after an awaited server action —
 * it lost the browser's transient user activation and was silently suppressed on
 * the first tap. Narrowing the hook is what makes that class of behaviour
 * unavailable rather than merely unused. Desktop callers pass nothing and are
 * untouched.
 */
/**
 * Where a rep goes when the workspace has no WhatsApp connected.
 * `section=whatsapp` opens that accordion directly — a documented, permanent
 * contract of the integrations page (see LeadSourcesSection), already used by
 * LeadsFirstRun and TemplatesSection. Defined here so every mobile caller
 * routes to the same place.
 */
export const WHATSAPP_CONNECT_HREF = '/settings/integrations?section=whatsapp'

/**
 * How the attempt ended, so the caller can close the contact-triad invariant
 * with exactly one terminal event. Returned rather than inferred: only this
 * function knows which branch ran.
 */
export type OpenLeadWhatsappOutcome =
  | { kind: 'opened' }
  | { kind: 'no-connection' }
  | { kind: 'no-recipient' }
  | { kind: 'unavailable' }

export async function openLeadWhatsappInInbox(
  leadId: number,
  push: (href: string) => void,
  opts?: { onNoConnection?: () => void },
): Promise<OpenLeadWhatsappOutcome> {
  const { conversationId, reason } = await resolveLeadWhatsappConversation(leadId)
  if (conversationId) {
    push(`/inbox?conversation=${conversationId}`)
    return { kind: 'opened' }
  }

  if (reason === 'no-connection') {
    if (opts?.onNoConnection) {
      opts.onNoConnection()
      return { kind: 'no-connection' }
    }
    toast('message', 'יש לחבר WhatsApp בהגדרות לפני פתיחת שיחה')
    return { kind: 'no-connection' }
  }
  if (reason === 'no-recipient') {
    toast('message', 'לליד אין מספר טלפון תקין לשיחת WhatsApp')
    return { kind: 'no-recipient' }
  }
  toast('message', 'לא ניתן לפתוח שיחת WhatsApp לליד זה כרגע')
  return { kind: 'unavailable' }
}
