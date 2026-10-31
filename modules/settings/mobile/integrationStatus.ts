import { FACEBOOK_NOTICES, WHATSAPP_NOTICES } from '@/lib/connections/messages'
import type { FacebookHealthStatus } from '@/lib/facebook/health'
import { noticeForComposerHealth } from '@/lib/inbox/whatsappComposerDecision'
import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import type { StatusRole } from '@/lib/StatusBadge'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { localizeFacebookNotice, localizeWhatsappNotice } from '@/lib/connections/localizedNotices'

/**
 * Landing-card copy for Integrations on a phone.
 *
 * Status language is the same registry WhatsappConnect / FacebookConnect already
 * use. This file only chooses which sentence belongs on the closed card so the
 * owner can see connected / not connected / needs attention without opening an
 * accordion.
 *
 * `locale` (Hebrew by default — the exact sentences as before) words every
 * card; the state still decides WHICH sentence, by code. Notices come from the
 * same registry, localized by their code (`localizedNotices.ts`).
 */

export type IntegrationCardCopy = {
  statusLabel: string
  explanation: string
  actionLabel?: string
  role: StatusRole
}

export function whatsappLandingCopy(input: {
  connected: boolean
  status: WhatsappHealthPrimary
}, locale: UiLocale = 'he'): IntegrationCardCopy {
  const t = translatorFor(locale)
  if (!input.connected || input.status === 'disconnected') {
    return {
      statusLabel: t('settings.integrations.card.notConnected'),
      explanation: t('settings.mobile.status.wa.explain'),
      actionLabel: t('settings.integrations.whatsapp.connectPhone'),
      role: 'neutral',
    }
  }

  if (input.status === 'operational') {
    return {
      statusLabel: t('settings.integrations.card.connected'),
      explanation: t('settings.mobile.status.wa.healthy'),
      actionLabel: t('settings.mobile.landing.manage'),
      role: 'success',
    }
  }

  /**
   * Throttled is handled BEFORE the generic mapping below.
   *
   * That mapping turns any non-operational notice into `role: 'warning'` with
   * `notice.action ?? 'ניהול'`, which would dress a transient Meta rate limit as
   * something needing attention and hand the owner a button for a state that
   * asks nothing of them. `info` + no action says what is true: the connection
   * works, only our status check is briefly limited, and it clears itself.
   */
  if (input.status === 'throttled') {
    const throttled = localizeWhatsappNotice(WHATSAPP_NOTICES.throttled, locale) ?? WHATSAPP_NOTICES.throttled
    return {
      statusLabel: throttled.title,
      explanation: throttled.explanation,
      role: 'info',
    }
  }

  const health = noticeForComposerHealth(input.status) ?? WHATSAPP_NOTICES.needs_verification
  const notice = localizeWhatsappNotice(health, locale) ?? health
  return {
    statusLabel: notice.title,
    explanation: notice.explanation,
    actionLabel: notice.action ?? t('settings.mobile.landing.manage'),
    role: notice.tone === 'error' ? 'error' : 'warning',
  }
}

export function facebookLandingCopy(input: {
  connection: { pageName: string } | null
  health: FacebookHealthStatus | null
}, locale: UiLocale = 'he'): IntegrationCardCopy {
  const t = translatorFor(locale)
  const fb = (notice: (typeof FACEBOOK_NOTICES)[string]) => localizeFacebookNotice(notice, locale) ?? notice
  if (!input.connection) {
    return {
      statusLabel: t('settings.integrations.card.notConnected'),
      explanation: t('settings.mobile.status.fb.explain'),
      actionLabel: t('settings.mobile.status.fb.connect'),
      role: 'neutral',
    }
  }

  const health = input.health
  if (health?.needsReconnect) {
    return {
      statusLabel: fb(FACEBOOK_NOTICES.expired).title,
      explanation: fb(FACEBOOK_NOTICES.expired).explanation,
      actionLabel: fb(FACEBOOK_NOTICES.expired).action ?? t('settings.mobile.status.fb.reconnect'),
      role: 'warning',
    }
  }

  if (health && !health.needsReconnect && !health.subscribed) {
    return {
      statusLabel: fb(FACEBOOK_NOTICES.repairing).title,
      explanation: fb(FACEBOOK_NOTICES.repairing).explanation,
      actionLabel: t('settings.mobile.landing.manage'),
      role: 'warning',
    }
  }

  const healthy = !!(health && health.tokenValid && health.permissionsOk && health.subscribed)
  return {
    statusLabel: t('settings.integrations.card.connected'),
    explanation: healthy
      ? t('settings.mobile.status.fb.healthyPage', { page: input.connection.pageName })
      : t('settings.mobile.status.fb.page', { page: input.connection.pageName }),
    actionLabel: t('settings.mobile.landing.manage'),
    role: healthy ? 'success' : 'warning',
  }
}

export function readyMessagesLandingCopy(input: {
  enabled: boolean
  connected: boolean
  messagingReady: boolean
  total: number
  approved: number
  pending: number
}, locale: UiLocale = 'he'): IntegrationCardCopy | null {
  if (!input.enabled) return null
  const t = translatorFor(locale)

  if (!input.connected) {
    return {
      statusLabel: t('settings.mobile.status.rm.waiting'),
      explanation: t('settings.mobile.status.rm.notConnected'),
      actionLabel: t('settings.mobile.status.rm.connectFirst'),
      role: 'neutral',
    }
  }

  if (!input.messagingReady) {
    return {
      statusLabel: t('settings.mobile.status.rm.notReady'),
      explanation: t('settings.mobile.status.rm.notReadyExplain'),
      actionLabel: t('settings.mobile.status.rm.manageWhatsapp'),
      role: 'warning',
    }
  }

  if (input.total === 0) {
    return {
      statusLabel: t('settings.mobile.status.rm.none'),
      explanation: t('settings.mobile.status.rm.noneExplain'),
      actionLabel: t('settings.mobile.status.rm.create'),
      role: 'neutral',
    }
  }

  const parts: string[] = []
  // Counts are passed as their digits, so Hebrew prints exactly what it printed.
  if (input.approved > 0) parts.push(t('settings.mobile.status.rm.approved', { count: String(input.approved) }))
  if (input.pending > 0) parts.push(t('settings.mobile.status.rm.pending', { count: String(input.pending) }))
  return {
    statusLabel: t('settings.mobile.status.rm.total', { count: String(input.total) }),
    explanation: parts.join(' · ') || t('settings.mobile.status.rm.fallback'),
    actionLabel: t('settings.mobile.status.rm.manage'),
    role: input.approved > 0 ? 'success' : 'warning',
  }
}

export function calendarLandingCopy(input: {
  state: 'not_connected' | 'connected' | 'reauth_required'
  email: string | null
}, locale: UiLocale = 'he'): IntegrationCardCopy {
  const t = translatorFor(locale)
  if (input.state === 'reauth_required') {
    return {
      statusLabel: t('settings.integrations.calendar.needsReconnect'),
      explanation: t('settings.mobile.status.cal.reauthExplain'),
      actionLabel: t('settings.integrations.calendar.reconnect'),
      role: 'warning',
    }
  }
  if (input.state === 'connected') {
    return {
      statusLabel: t('settings.integrations.card.connected'),
      explanation: input.email
        ? t('settings.mobile.status.connectedAs', { email: input.email })
        : t('settings.mobile.status.cal.connectedExplain'),
      actionLabel: t('settings.mobile.landing.manage'),
      role: 'success',
    }
  }
  return {
    statusLabel: t('settings.integrations.card.notConnected'),
    explanation: t('settings.mobile.status.cal.explain'),
    actionLabel: t('settings.mobile.status.cal.connect'),
    role: 'neutral',
  }
}
