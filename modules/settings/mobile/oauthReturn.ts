import { FACEBOOK_NOTICES, facebookNotice, whatsappNotice } from '@/lib/connections/messages'
import type { IntegrationCardCopy } from './integrationStatus'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { localizeFacebookNotice, localizeWhatsappNotice } from '@/lib/connections/localizedNotices'

/*
 * The *ReturnCopy producers take an optional `locale` (Hebrew by default: the
 * exact sentences as before). The query CODES still decide which sentence;
 * only its wording follows the language. Parsing, sheet routing and the
 * auto-complete rules below are unchanged.
 */

/**
 * Query keys the existing OAuth callbacks already write. Mobile reads them
 * so a return from Facebook / WhatsApp / Calendar / Drive continues the
 * action the user started, instead of showing a silent Connect button.
 */
export type OAuthReturnQuery = {
  section?: string | null
  select?: string | null
  error?: string | null
  wa_error?: string | null
  gcal?: string | null
  gcal_error?: string | null
  gdrive?: string | null
  gdrive_error?: string | null
}

export type IntegrationSheet = 'whatsapp' | 'facebook' | 'calendar' | 'drive' | null

export function firstQueryValue(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0]
  return null
}

export function parseOAuthReturnQuery(sp: {
  [key: string]: string | string[] | undefined
}): OAuthReturnQuery {
  return {
    section: firstQueryValue(sp.section),
    select: firstQueryValue(sp.select),
    error: firstQueryValue(sp.error),
    wa_error: firstQueryValue(sp.wa_error),
    gcal: firstQueryValue(sp.gcal),
    gcal_error: firstQueryValue(sp.gcal_error),
    gdrive: firstQueryValue(sp.gdrive),
    gdrive_error: firstQueryValue(sp.gdrive_error),
  }
}

/**
 * Which manage sheet to open after an external return. Pending cookies and
 * callback query params are the same signals desktop already uses; mobile
 * previously ignored them on the landing cards.
 */
export function resolveMobileIntegrationSheet(input: {
  query: OAuthReturnQuery
  pendingPages: unknown[] | null
  pendingPhones: unknown[] | null
}): IntegrationSheet {
  const { query, pendingPages, pendingPhones } = input
  // Explicit callback / deep-link params win over leftover pending cookies.
  if (query.section === 'whatsapp' || query.wa_error) return 'whatsapp'
  if (query.section === 'facebook' || query.select === '1' || query.error) return 'facebook'
  if (query.section === 'google-calendar' || query.gcal || query.gcal_error) return 'calendar'
  if (query.gdrive || query.gdrive_error) return 'drive'
  if (pendingPhones && pendingPhones.length > 0) return 'whatsapp'
  if (pendingPages && pendingPages.length > 0) return 'facebook'
  return null
}

export function facebookReturnCopy(input: {
  pendingPages: unknown[] | null
  error: string | null
  select: boolean
  completing: boolean
}, locale: UiLocale = 'he'): IntegrationCardCopy | null {
  const t = translatorFor(locale)
  if (input.completing) {
    return {
      statusLabel: t('settings.mobile.landing.completing'),
      explanation: t('settings.mobile.oauth.fbApproved'),
      actionLabel: t('settings.mobile.landing.completing'),
      role: 'warning',
    }
  }
  if (input.error) {
    const found = facebookNotice(input.error) ?? FACEBOOK_NOTICES.token
    const notice = localizeFacebookNotice(found, locale) ?? found
    return {
      statusLabel: notice.title,
      explanation: notice.explanation,
      actionLabel: notice.action ?? t('settings.mobile.oauth.retry'),
      role: notice.tone === 'attention' ? 'warning' : 'error',
    }
  }
  if (input.pendingPages && input.pendingPages.length > 0) {
    return {
      statusLabel: t('settings.mobile.oauth.pickPage'),
      explanation:
        input.pendingPages.length === 1
          ? t('settings.mobile.oauth.fbApproved')
          : t('settings.mobile.oauth.fbPick'),
      actionLabel: t('settings.mobile.oauth.finish'),
      role: 'warning',
    }
  }
  if (input.select) {
    return {
      statusLabel: t('settings.mobile.oauth.notCompleted'),
      explanation: t('settings.mobile.oauth.fbNoPage'),
      actionLabel: t('settings.mobile.oauth.retry'),
      role: 'error',
    }
  }
  return null
}

export function whatsappReturnCopy(input: {
  pendingPhones: unknown[] | null
  error: string | null
  completing: boolean
}, locale: UiLocale = 'he'): IntegrationCardCopy | null {
  const t = translatorFor(locale)
  if (input.completing) {
    return {
      statusLabel: t('settings.mobile.landing.completing'),
      explanation: t('settings.mobile.oauth.waApproved'),
      actionLabel: t('settings.mobile.landing.completing'),
      role: 'warning',
    }
  }
  if (input.error) {
    if (input.error === 'cancelled' || input.error === 'denied') {
      return {
        statusLabel: t('settings.mobile.oauth.waNotCompleted'),
        explanation: t('settings.mobile.oauth.waStopped'),
        actionLabel: t('settings.mobile.oauth.retry'),
        role: 'error',
      }
    }
    const notice = localizeWhatsappNotice(whatsappNotice(input.error), locale)
    if (notice) {
      return {
        statusLabel: notice.title,
        explanation: notice.explanation,
        actionLabel: notice.action ?? t('settings.mobile.oauth.retry'),
        role: notice.tone === 'attention' ? 'warning' : 'error',
      }
    }
  }
  if (input.pendingPhones && input.pendingPhones.length > 0) {
    return {
      statusLabel: t('settings.mobile.oauth.pickPhone'),
      explanation:
        input.pendingPhones.length === 1
          ? t('settings.mobile.oauth.waApproved')
          : t('settings.mobile.oauth.waPick'),
      actionLabel: t('settings.mobile.oauth.finish'),
      role: 'warning',
    }
  }
  return null
}

export function calendarReturnCopy(input: {
  connected: boolean
  error: string | null
  connecting: boolean
}, locale: UiLocale = 'he'): IntegrationCardCopy | null {
  const t = translatorFor(locale)
  if (input.connected) return null
  if (input.error) {
    return {
      statusLabel: input.error === 'denied' ? t('settings.mobile.oauth.notCompleted') : t('settings.mobile.oauth.failed'),
      explanation:
        input.error === 'denied'
          ? t('settings.mobile.oauth.gcalDenied')
          : t('settings.mobile.oauth.gcalFailed'),
      actionLabel: t('settings.mobile.oauth.retry'),
      role: 'error',
    }
  }
  if (input.connecting) {
    return {
      statusLabel: t('settings.mobile.landing.completing'),
      explanation: t('settings.mobile.oauth.gcalApproved'),
      actionLabel: t('settings.mobile.landing.completing'),
      role: 'warning',
    }
  }
  return null
}

export function driveReturnCopy(input: {
  connected: boolean
  error: string | null
  connecting: boolean
}, locale: UiLocale = 'he'): IntegrationCardCopy | null {
  const t = translatorFor(locale)
  if (input.connected) return null
  if (input.connecting) {
    return {
      statusLabel: t('settings.mobile.landing.completing'),
      explanation: t('settings.mobile.oauth.gdriveApproved'),
      actionLabel: t('settings.mobile.landing.completing'),
      role: 'warning',
    }
  }
  if (input.error) {
    return {
      statusLabel: input.error === 'denied' ? t('settings.mobile.oauth.notCompleted') : t('settings.mobile.oauth.failed'),
      explanation:
        input.error === 'denied'
          ? t('settings.mobile.oauth.gdriveDenied')
          : t('settings.mobile.oauth.gdriveFailed'),
      actionLabel: t('settings.mobile.oauth.retry'),
      role: 'error',
    }
  }
  return null
}

export function shouldAutoCompleteFacebook(pendingPages: unknown[] | null, connected: boolean): boolean {
  return !connected && Array.isArray(pendingPages) && pendingPages.length === 1
}

export function shouldAutoCompleteWhatsapp(pendingPhones: unknown[] | null, connected: boolean): boolean {
  return !connected && Array.isArray(pendingPhones) && pendingPhones.length === 1
}
