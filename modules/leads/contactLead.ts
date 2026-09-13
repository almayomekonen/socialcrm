'use client'

import { toast } from '@/lib/toast'
import { openLeadWhatsappInInbox } from '@/modules/inbox/client/openLeadWhatsapp'
import { resolveLeadContactPlan } from '@/modules/leads/contactPlan'
import { contactBlocked, contactClicked, contactSucceeded } from '@/modules/leads/contactEvents'
import type { LeadContactSurface } from '@/modules/leads/contactEvents'

/**
 * ONE CONTACT DOCTRINE, for every lead-contact control that is a BUTTON.
 *
 * Anchors (`LeadContactActions`, the composer fallback) render their href
 * directly and do not need this. Everything else — menu items, sheet rows,
 * table row actions — routes through here, so the rule cannot differ by surface:
 *
 *   connected / unknown  → the in-app conversation, unchanged
 *   not connected + phone → hand off to WhatsApp itself
 *   no usable phone       → block cleanly, say why
 *
 * WHY `location.assign` AND NOT `window.open`. These call sites are buttons, so
 * there is no href for the browser to follow. `location.assign` is a TOP-LEVEL
 * navigation, which browsers do not gesture-gate — unlike `window.open`, whose
 * popup IS gated and which, called after an awaited server action, is exactly
 * the defect that made the first tap do nothing. Nothing is awaited before the
 * assign here: the plan is resolved synchronously from data already on the
 * client, so the navigation happens in the same turn as the click.
 *
 * Emits the triad and nothing else: intent on the click, exactly one terminal
 * for that same click, never a terminal without an intent.
 */
export function contactLeadViaWhatsapp(
  lead: { id: number; phone?: string | null } | null | undefined,
  whatsappConnected: boolean | undefined,
  push: (href: string) => void,
  surface: LeadContactSurface,
  opts?: { onNoConnection?: () => void },
): void {
  if (!lead?.id) return
  const leadId = lead.id
  const plan = resolveLeadContactPlan({ phone: lead.phone, whatsappConnected })

  if (plan.kind === 'native') {
    contactClicked(leadId, surface, 'whatsapp_native')
    // Handoff, NOT delivery: we know the rep reached WhatsApp with this number,
    // and nothing about whether a message was written, sent or answered.
    contactSucceeded(leadId, surface, 'whatsapp_native')
    window.location.assign(plan.href)
    return
  }

  if (plan.kind === 'blocked') {
    contactClicked(leadId, surface, 'whatsapp_native')
    contactBlocked(leadId, surface, 'no_phone')
    toast('message', 'לליד אין מספר טלפון תקין לוואטסאפ')
    return
  }

  contactClicked(leadId, surface, 'whatsapp_api')
  void openLeadWhatsappInInbox(leadId, push, opts).then((outcome) => {
    if (outcome.kind === 'opened') contactSucceeded(leadId, surface, 'whatsapp_api')
    else if (outcome.kind === 'no-recipient') contactBlocked(leadId, surface, 'no_phone')
    else contactBlocked(leadId, surface, 'no_connection')
  })
}
