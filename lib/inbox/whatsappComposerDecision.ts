import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import type { WhatsappServiceWindow } from '@/lib/inbox/whatsappServiceWindow'
import { WHATSAPP_NOTICES, type ConnectionNotice } from '@/lib/connections/messages'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

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

export type ServiceWindowCopy = {
  closedTitle: string
  closedBody: string
  closedCta: string
  closedNoTemplate: string
  unknown: string
  templatesSettings: string
}

/** Service-window copy in the interface locale (catalog `inbox.serviceWindow.*`). */
export function serviceWindowCopy(locale: UiLocale = 'he'): ServiceWindowCopy {
  const t = translatorFor(locale)
  return {
    closedTitle: t('inbox.serviceWindow.closedTitle'),
    closedBody: t('inbox.serviceWindow.closedBody'),
    closedCta: t('inbox.serviceWindow.closedCta'),
    closedNoTemplate: t('inbox.serviceWindow.closedNoTemplate'),
    unknown: t('inbox.serviceWindow.unknown'),
    templatesSettings: t('inbox.serviceWindow.templatesSettings'),
  }
}

/** The Hebrew copy, for existing readers. */
export const SERVICE_WINDOW_COPY: Readonly<ServiceWindowCopy> = serviceWindowCopy('he')

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

  // `throttled` passes. It means Meta rate-limited our STATUS PROBE — we could
  // not check the connection — and that is not a reason to stop the rep sending.
  // The credential is the same one the probe was using, so a genuinely dead token
  // still fails at Graph and reports itself. Blocking on "we could not check"
  // turns a Meta hiccup into an outage.
  //
  // This decision governs what the COMPOSER offers — one layer of the send flow,
  // not the last word. Final eligibility is enforced server-side by
  // `assertWhatsappFreeTextAllowed` (lib/inbox/whatsappFreeTextGate.ts) for
  // session text and by `sendTemplateToLead` for templates. All three carry the
  // same operational-or-throttled rule and must stay in agreement, or the
  // composer invites a send the server then refuses.
  //
  // Every genuinely broken state — token, webhook, restricted, registration
  // pending, unknown — still blocks exactly as before.
  if (health !== 'operational' && health !== 'throttled') {
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

type HealthNoticeCode = 'not_ready' | 'restricted' | 'expired' | 'webhook' | 'throttled' | 'needs_verification'

function healthNoticeCode(health: WhatsappHealthPrimary): HealthNoticeCode | null {
  if (health === 'registration_pending' || health === 'inbound_only') return 'not_ready'
  if (health === 'restricted') return 'restricted'
  if (health === 'token') return 'expired'
  if (health === 'webhook') return 'webhook'
  if (health === 'throttled') return 'throttled'
  if (health === 'unknown') return 'needs_verification'
  return null
}

/** Catalog keys of the notice text the composer shows (`inbox.health.<code>`), reasons in order. */
const NOTICE_KEYS: Record<HealthNoticeCode, { title: MessageKey; explanation: MessageKey; reasons: MessageKey[]; nextStep: MessageKey }> = {
  not_ready: {
    title: 'inbox.health.not_ready.title',
    explanation: 'inbox.health.not_ready.explanation',
    reasons: ['inbox.health.not_ready.reason1', 'inbox.health.not_ready.reason2'],
    nextStep: 'inbox.health.not_ready.nextStep',
  },
  restricted: {
    title: 'inbox.health.restricted.title',
    explanation: 'inbox.health.restricted.explanation',
    reasons: [],
    nextStep: 'inbox.health.restricted.nextStep',
  },
  expired: {
    title: 'inbox.health.expired.title',
    explanation: 'inbox.health.expired.explanation',
    reasons: ['inbox.health.expired.reason1', 'inbox.health.expired.reason2'],
    nextStep: 'inbox.health.expired.nextStep',
  },
  webhook: {
    title: 'inbox.health.webhook.title',
    explanation: 'inbox.health.webhook.explanation',
    reasons: [],
    nextStep: 'inbox.health.webhook.nextStep',
  },
  throttled: {
    title: 'inbox.health.throttled.title',
    explanation: 'inbox.health.throttled.explanation',
    reasons: [],
    nextStep: 'inbox.health.throttled.nextStep',
  },
  needs_verification: {
    title: 'inbox.health.needs_verification.title',
    explanation: 'inbox.health.needs_verification.explanation',
    reasons: [],
    nextStep: 'inbox.health.needs_verification.nextStep',
  },
}

/**
 * Existing Connection Health copy, same mapping as Settings → WhatsappConnect.
 * Duplicated here so the inbox does not import the Embedded Signup component.
 *
 * Hebrew returns the shared `WHATSAPP_NOTICES` entry itself (settings reads the
 * same objects). Another locale gets the same notice with its displayed text
 * (title, explanation, reasons, next step) from the catalog; `tone` and the
 * actions are unchanged, so nothing about what the notice does differs.
 */
export function noticeForComposerHealth(health: WhatsappHealthPrimary, locale: UiLocale = 'he'): ConnectionNotice | null {
  const code = healthNoticeCode(health)
  if (!code) return null
  const base = WHATSAPP_NOTICES[code]
  if (locale === 'he') return base
  const t = translatorFor(locale)
  const keys = NOTICE_KEYS[code]
  return {
    ...base,
    title: t(keys.title),
    explanation: t(keys.explanation),
    ...(base.reasons ? { reasons: keys.reasons.map((k) => t(k)) } : {}),
    ...(base.nextStep ? { nextStep: t(keys.nextStep) } : {}),
  }
}

/** The label above a notice's reasons, in the interface locale. */
export function noticeReasonsLabel(locale: UiLocale = 'he'): string {
  return translatorFor(locale)('inbox.health.reasonsLabel')
}
