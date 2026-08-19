import { FACEBOOK_NOTICES, WHATSAPP_NOTICES } from '@/lib/connections/messages'
import type { FacebookHealthStatus } from '@/lib/facebook/health'
import { noticeForComposerHealth } from '@/lib/inbox/whatsappComposerDecision'
import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import type { StatusRole } from '@/lib/StatusBadge'

/**
 * Landing-card copy for Integrations on a phone.
 *
 * Status language is the same registry WhatsappConnect / FacebookConnect already
 * use. This file only chooses which sentence belongs on the closed card so the
 * owner can see connected / not connected / needs attention without opening an
 * accordion.
 */

export type IntegrationCardCopy = {
  statusLabel: string
  explanation: string
  actionLabel: string
  role: StatusRole
}

export function whatsappLandingCopy(input: {
  connected: boolean
  status: WhatsappHealthPrimary
}): IntegrationCardCopy {
  if (!input.connected || input.status === 'disconnected') {
    return {
      statusLabel: 'לא מחובר',
      explanation: 'חברו את מספר הוואטסאפ העסקי כדי לקבל לידים אוטומטית.',
      actionLabel: 'חבר וואטסאפ',
      role: 'neutral',
    }
  }

  if (input.status === 'operational') {
    return {
      statusLabel: 'מחובר',
      explanation: 'החיבור תקין — לידים מגיעים אוטומטית.',
      actionLabel: 'ניהול',
      role: 'success',
    }
  }

  const notice = noticeForComposerHealth(input.status) ?? WHATSAPP_NOTICES.needs_verification
  return {
    statusLabel: notice.title,
    explanation: notice.explanation,
    actionLabel: notice.action ?? 'ניהול',
    role: notice.tone === 'error' ? 'error' : 'warning',
  }
}

export function facebookLandingCopy(input: {
  connection: { pageName: string } | null
  health: FacebookHealthStatus | null
}): IntegrationCardCopy {
  if (!input.connection) {
    return {
      statusLabel: 'לא מחובר',
      explanation: 'חברו את דף הפייסבוק כדי לקבל לידים מפייסבוק ומאינסטגרם.',
      actionLabel: 'חבר פייסבוק',
      role: 'neutral',
    }
  }

  const health = input.health
  if (health?.needsReconnect) {
    return {
      statusLabel: FACEBOOK_NOTICES.expired.title,
      explanation: FACEBOOK_NOTICES.expired.explanation,
      actionLabel: FACEBOOK_NOTICES.expired.action ?? 'לחבר מחדש',
      role: 'warning',
    }
  }

  if (health && !health.needsReconnect && !health.subscribed) {
    return {
      statusLabel: FACEBOOK_NOTICES.repairing.title,
      explanation: FACEBOOK_NOTICES.repairing.explanation,
      actionLabel: 'ניהול',
      role: 'warning',
    }
  }

  const healthy = !!(health && health.tokenValid && health.permissionsOk && health.subscribed)
  return {
    statusLabel: 'מחובר',
    explanation: healthy
      ? `מחובר לדף ${input.connection.pageName} — לידים מגיעים אוטומטית.`
      : `מחובר לדף ${input.connection.pageName}.`,
    actionLabel: 'ניהול',
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
}): IntegrationCardCopy | null {
  if (!input.enabled) return null

  if (!input.connected) {
    return {
      statusLabel: 'מחכה לחיבור',
      explanation: 'כדי ליצור הודעות מוכנות, חברו קודם את מספר הוואטסאפ העסקי.',
      actionLabel: 'חבר וואטסאפ קודם',
      role: 'neutral',
    }
  }

  if (!input.messagingReady) {
    return {
      statusLabel: 'החיבור עדיין לא מוכן',
      explanation: 'לאחר שהחיבור יאומת, אפשר יהיה ליצור הודעות מוכנות.',
      actionLabel: 'ניהול וואטסאפ',
      role: 'warning',
    }
  }

  if (input.total === 0) {
    return {
      statusLabel: 'אין הודעות',
      explanation: 'הודעה מוכנה מאפשרת לפנות לליד גם אחרי שהשיחה נרגעה.',
      actionLabel: 'צרו הודעה מוכנה',
      role: 'neutral',
    }
  }

  const parts: string[] = []
  if (input.approved > 0) parts.push(`${input.approved} מוכנות לשליחה`)
  if (input.pending > 0) parts.push(`${input.pending} בבדיקה`)
  return {
    statusLabel: `${input.total} הודעות`,
    explanation: parts.join(' · ') || 'ניהול ההודעות המוכנות לשליחה בוואטסאפ.',
    actionLabel: 'ניהול הודעות',
    role: input.approved > 0 ? 'success' : 'warning',
  }
}

export function calendarLandingCopy(input: {
  state: 'not_connected' | 'connected' | 'reauth_required'
  email: string | null
}): IntegrationCardCopy {
  if (input.state === 'reauth_required') {
    return {
      statusLabel: 'דורש חיבור מחדש',
      explanation: 'החיבור ליומן פג. יש להתחבר מחדש כדי לסנכרן פגישות חדשות.',
      actionLabel: 'חבר מחדש',
      role: 'warning',
    }
  }
  if (input.state === 'connected') {
    return {
      statusLabel: 'מחובר',
      explanation: input.email
        ? `מחובר · ${input.email}`
        : 'תזמון פגישות עם לידים ישירות מתוך המערכת.',
      actionLabel: 'ניהול',
      role: 'success',
    }
  }
  return {
    statusLabel: 'לא מחובר',
    explanation: 'תזמון פגישות עם לידים וקישורי Google Meet אוטומטיים.',
    actionLabel: 'חבר יומן',
    role: 'neutral',
  }
}
