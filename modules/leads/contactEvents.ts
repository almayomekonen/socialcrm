'use client'

import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import type { LeadContactBlockedReason, LeadContactChannel } from '@/actions/analytics/recordLeadActionEvent'

/**
 * The contact triad, emitted identically from every surface.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT: every `contactClicked` is followed
 * by exactly one `contactSucceeded` or `contactBlocked`. Production currently
 * shows nine `lead_action_taken { action: 'message' }` taps against zero
 * conversations and zero failures, because the only event fires on tap and
 * nothing records how it ended. Splitting intent from outcome is the whole
 * point; funnelling all three through one module is what stops a surface from
 * emitting the intent and forgetting the resolution.
 *
 * All three are fire-and-forget. Telemetry must never delay or break a contact
 * attempt — and in the native branch it must never be awaited before the
 * navigation, because an await there would spend the user gesture.
 */

export type LeadContactSurface = 'mobile' | 'desktop'

export function contactClicked(leadId: number, surface: LeadContactSurface, intendedChannel?: LeadContactChannel): void {
  void recordLeadActionEvent('lead_contact_clicked', { leadId, surface, intendedChannel }).catch(() => {})
}

export function contactBlocked(leadId: number, surface: LeadContactSurface, reason: LeadContactBlockedReason): void {
  void recordLeadActionEvent('lead_contact_blocked', { leadId, surface, reason }).catch(() => {})
}

/**
 * For `whatsapp_native` this records a HANDOFF, not a delivery: SocialCRM put
 * the rep in WhatsApp with this lead's number. Whether they typed anything,
 * sent it, or got a reply is outside our process and is not claimed here.
 */
export function contactSucceeded(leadId: number, surface: LeadContactSurface, channel: LeadContactChannel): void {
  void recordLeadActionEvent('lead_contact_succeeded', { leadId, surface, channel }).catch(() => {})
}
