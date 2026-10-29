import { FACEBOOK_NOTICES, type ConnectionNotice } from '@/lib/connections/messages'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The Facebook notices `/inbox/messenger` and `/inbox/comments` can show, in the
 * page's interface language. Hebrew returns the shared `FACEBOOK_NOTICES` entry
 * itself (settings keeps reading the constants), so a Hebrew screen is exactly
 * what it was. The same shape as `noticeForComposerHealth` for WhatsApp.
 */
export type MetaInboxNoticeCode =
  | 'messenger_permission'
  | 'messenger_declined'
  | 'messenger_not_subscribed'
  | 'expired'
  | 'comment_replies_permission'
  | 'comment_replies_declined'
  | 'in_app_browser'

type Keys = { title: MessageKey; explanation: MessageKey; reasons: MessageKey[]; nextStep: MessageKey; action: MessageKey }

const NOTICE_KEYS: Record<MetaInboxNoticeCode, Keys> = {
  messenger_permission: {
    title: 'inbox.metaNotice.messenger_permission.title',
    explanation: 'inbox.metaNotice.messenger_permission.explanation',
    reasons: [],
    nextStep: 'inbox.metaNotice.messenger_permission.nextStep',
    action: 'inbox.metaNotice.messenger_permission.action',
  },
  messenger_declined: {
    title: 'inbox.metaNotice.messenger_declined.title',
    explanation: 'inbox.metaNotice.messenger_declined.explanation',
    reasons: ['inbox.metaNotice.messenger_declined.reason1'],
    nextStep: 'inbox.metaNotice.messenger_declined.nextStep',
    action: 'inbox.metaNotice.messenger_declined.action',
  },
  messenger_not_subscribed: {
    title: 'inbox.metaNotice.messenger_not_subscribed.title',
    explanation: 'inbox.metaNotice.messenger_not_subscribed.explanation',
    reasons: [],
    nextStep: 'inbox.metaNotice.messenger_not_subscribed.nextStep',
    action: 'inbox.metaNotice.messenger_not_subscribed.action',
  },
  expired: {
    title: 'inbox.metaNotice.expired.title',
    explanation: 'inbox.metaNotice.expired.explanation',
    reasons: ['inbox.metaNotice.expired.reason1', 'inbox.metaNotice.expired.reason2'],
    nextStep: 'inbox.metaNotice.expired.nextStep',
    action: 'inbox.metaNotice.expired.action',
  },
  comment_replies_permission: {
    title: 'inbox.metaNotice.comment_replies_permission.title',
    explanation: 'inbox.metaNotice.comment_replies_permission.explanation',
    reasons: [],
    nextStep: 'inbox.metaNotice.comment_replies_permission.nextStep',
    action: 'inbox.metaNotice.comment_replies_permission.action',
  },
  comment_replies_declined: {
    title: 'inbox.metaNotice.comment_replies_declined.title',
    explanation: 'inbox.metaNotice.comment_replies_declined.explanation',
    reasons: ['inbox.metaNotice.comment_replies_declined.reason1'],
    nextStep: 'inbox.metaNotice.comment_replies_declined.nextStep',
    action: 'inbox.metaNotice.comment_replies_declined.action',
  },
  in_app_browser: {
    title: 'inbox.metaNotice.in_app_browser.title',
    explanation: 'inbox.metaNotice.in_app_browser.explanation',
    reasons: [],
    nextStep: 'inbox.metaNotice.in_app_browser.nextStep',
    action: 'inbox.metaNotice.in_app_browser.action',
  },
}

export const META_INBOX_NOTICE_CODES = Object.keys(NOTICE_KEYS) as MetaInboxNoticeCode[]

export function metaInboxNotice(code: MetaInboxNoticeCode, locale: UiLocale = 'he'): ConnectionNotice {
  const base = FACEBOOK_NOTICES[code]
  if (locale === 'he') return base
  const t = translatorFor(locale)
  const keys = NOTICE_KEYS[code]
  return {
    ...base,
    title: t(keys.title),
    explanation: t(keys.explanation),
    ...(base.reasons ? { reasons: keys.reasons.map((k) => t(k)) } : {}),
    ...(base.nextStep ? { nextStep: t(keys.nextStep) } : {}),
    ...(base.action ? { action: t(keys.action) } : {}),
  }
}
