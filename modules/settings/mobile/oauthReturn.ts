import { FACEBOOK_NOTICES, facebookNotice, whatsappNotice } from '@/lib/connections/messages'
import type { IntegrationCardCopy } from './integrationStatus'

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
}): IntegrationCardCopy | null {
  if (input.completing) {
    return {
      statusLabel: 'משלים חיבור...',
      explanation: 'פייסבוק אושר. משלימים את חיבור הדף.',
      actionLabel: 'משלים חיבור...',
      role: 'warning',
    }
  }
  if (input.error) {
    const notice = facebookNotice(input.error) ?? FACEBOOK_NOTICES.token
    return {
      statusLabel: notice.title,
      explanation: notice.explanation,
      actionLabel: notice.action ?? 'לנסות שוב',
      role: notice.tone === 'attention' ? 'warning' : 'error',
    }
  }
  if (input.pendingPages && input.pendingPages.length > 0) {
    return {
      statusLabel: 'בחירת דף',
      explanation:
        input.pendingPages.length === 1
          ? 'פייסבוק אושר. משלימים את חיבור הדף.'
          : 'פייסבוק אושר. בחרו את הדף כדי להשלים את החיבור.',
      actionLabel: 'השלימו חיבור',
      role: 'warning',
    }
  }
  if (input.select) {
    return {
      statusLabel: 'החיבור לא הושלם',
      explanation: 'חזרנו מפייסבוק, אבל אין דף שמחכה לחיבור. אפשר לנסות שוב.',
      actionLabel: 'לנסות שוב',
      role: 'error',
    }
  }
  return null
}

export function whatsappReturnCopy(input: {
  pendingPhones: unknown[] | null
  error: string | null
  completing: boolean
}): IntegrationCardCopy | null {
  if (input.completing) {
    return {
      statusLabel: 'משלים חיבור...',
      explanation: 'וואטסאפ אושר. משלימים את חיבור המספר.',
      actionLabel: 'משלים חיבור...',
      role: 'warning',
    }
  }
  if (input.error) {
    if (input.error === 'cancelled' || input.error === 'denied') {
      return {
        statusLabel: 'החיבור לוואטסאפ לא הושלם',
        explanation: 'התהליך נעצר לפני שלב האישור, ולא נשמר מידע.',
        actionLabel: 'לנסות שוב',
        role: 'error',
      }
    }
    const notice = whatsappNotice(input.error)
    if (notice) {
      return {
        statusLabel: notice.title,
        explanation: notice.explanation,
        actionLabel: notice.action ?? 'לנסות שוב',
        role: notice.tone === 'attention' ? 'warning' : 'error',
      }
    }
  }
  if (input.pendingPhones && input.pendingPhones.length > 0) {
    return {
      statusLabel: 'בחירת מספר',
      explanation:
        input.pendingPhones.length === 1
          ? 'וואטסאפ אושר. משלימים את חיבור המספר.'
          : 'וואטסאפ אושר. בחרו את המספר כדי להשלים את החיבור.',
      actionLabel: 'השלימו חיבור',
      role: 'warning',
    }
  }
  return null
}

export function calendarReturnCopy(input: {
  connected: boolean
  error: string | null
  connecting: boolean
}): IntegrationCardCopy | null {
  if (input.connected) return null
  if (input.error) {
    return {
      statusLabel: input.error === 'denied' ? 'החיבור לא הושלם' : 'החיבור נכשל',
      explanation:
        input.error === 'denied'
          ? 'התהליך ביומן Google נעצר לפני האישור. אפשר לנסות שוב.'
          : 'לא הצלחנו לחבר את Google Calendar. אפשר לנסות שוב.',
      actionLabel: 'לנסות שוב',
      role: 'error',
    }
  }
  if (input.connecting) {
    return {
      statusLabel: 'משלים חיבור...',
      explanation: 'Google Calendar אושר. מעדכנים את מצב החיבור.',
      actionLabel: 'משלים חיבור...',
      role: 'warning',
    }
  }
  return null
}

export function driveReturnCopy(input: {
  connected: boolean
  error: string | null
  connecting: boolean
}): IntegrationCardCopy | null {
  if (input.connected) return null
  if (input.connecting) {
    return {
      statusLabel: 'משלים חיבור...',
      explanation: 'Google Drive אושר. מעדכנים את מצב החיבור.',
      actionLabel: 'משלים חיבור...',
      role: 'warning',
    }
  }
  if (input.error) {
    return {
      statusLabel: input.error === 'denied' ? 'החיבור לא הושלם' : 'החיבור נכשל',
      explanation:
        input.error === 'denied'
          ? 'התהליך ב-Google Drive נעצר לפני האישור. אפשר לנסות שוב.'
          : 'לא הצלחנו לחבר את Google Drive. אפשר לנסות שוב.',
      actionLabel: 'לנסות שוב',
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
