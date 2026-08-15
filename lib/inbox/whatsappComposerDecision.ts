import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import type { WhatsappServiceWindow } from '@/lib/inbox/whatsappServiceWindow'
import { WHATSAPP_NOTICES, type ConnectionNotice } from '@/lib/connections/messages'

/**
 * Conversation composer surface. Health is resolved FIRST, then the 24-hour
 * customer-service window. Restricted / disconnected / token / webhook never
 * fall through to a template picker.
 */

export type WhatsappComposerKind =
  | 'text'
  | 'template'
  | 'closed_no_template'
  | 'window_unknown'
  | 'health_blocked'
  | 'leadless'

export type WhatsappComposerDecision = {
  kind: WhatsappComposerKind
  health: WhatsappHealthPrimary
  window: WhatsappServiceWindow
  templatesEnabled: boolean
  canSendFreeText: boolean
  canSendTemplate: boolean
}

export const SERVICE_WINDOW_COPY = {
  closedTitle: 'חלון ההודעות ב-WhatsApp נסגר',
  closedBody:
    'עברו יותר מ-24 שעות מאז ההודעה האחרונה של הלקוח. כדי להמשיך את השיחה, יש לשלוח הודעה מוכנה מאושרת.',
  closedCta: 'בחר הודעה מוכנה',
  closedNoTemplate: 'חלון ההודעות נסגר. כדי להמשיך את השיחה, נדרשת הודעה מוכנה מאושרת.',
  unknown: 'לא ניתן לשלוח הודעת טקסט. אין הודעה נכנסת מהלקוח בשיחה הזו.',
  templatesSettings: 'להודעות המוכנות',
} as const

export const TEMPLATES_SETTINGS_HREF = '/settings/integrations?section=templates' as const
export const INTEGRATIONS_SETTINGS_HREF = '/settings/integrations' as const

export function resolveWhatsappComposerDecision(input: {
  leadId: number | null
  health: WhatsappHealthPrimary
  window: WhatsappServiceWindow
  templatesEnabled: boolean
  hasApprovedTemplates: boolean
}): WhatsappComposerDecision {
  const { health, window, templatesEnabled } = input
  const blocked = {
    health,
    window,
    templatesEnabled,
    canSendFreeText: false,
    canSendTemplate: false,
  }

  if (input.leadId == null || input.leadId <= 0) {
    return { ...blocked, kind: 'leadless' }
  }

  if (health !== 'operational') {
    return { ...blocked, kind: 'health_blocked' }
  }

  if (window === 'OPEN') {
    return { ...blocked, kind: 'text', canSendFreeText: true }
  }

  if (window === 'UNKNOWN') {
    return { ...blocked, kind: 'window_unknown' }
  }

  if (templatesEnabled && input.hasApprovedTemplates) {
    return { ...blocked, kind: 'template', canSendTemplate: true }
  }

  return { ...blocked, kind: 'closed_no_template' }
}

/**
 * Existing Connection Health copy, same mapping as Settings → WhatsappConnect.
 * Duplicated here so the inbox does not import the Embedded Signup component.
 */
export function noticeForComposerHealth(health: WhatsappHealthPrimary): ConnectionNotice | null {
  if (health === 'registration_pending' || health === 'inbound_only') return WHATSAPP_NOTICES.not_ready
  if (health === 'restricted') return WHATSAPP_NOTICES.restricted
  if (health === 'token') return WHATSAPP_NOTICES.expired
  if (health === 'webhook') return WHATSAPP_NOTICES.webhook
  if (health === 'unknown') return WHATSAPP_NOTICES.needs_verification
  return null
}
