import type { MessengerSavedReply } from '@/db/messengerSavedReplies'
import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The saved-reply editor's draft and its conversions (split from
 * MessengerSavedReplies). Pure: what is typed becomes the action payload
 * exactly as before.
 */
export type Draft = {
  id: number | null
  title: string
  body: string
  quickReplies: string[]
  buttons: { title: string; url: string }[]
  attachmentUrl: string
  attachmentType: 'image' | 'video' | 'audio' | 'file'
}

export const EMPTY: Draft = {
  id: null,
  title: '',
  body: '',
  quickReplies: [],
  buttons: [],
  attachmentUrl: '',
  attachmentType: 'file',
}

export function toDraft(reply: MessengerSavedReply): Draft {
  return {
    id: reply.id,
    title: reply.title,
    body: reply.body,
    quickReplies: reply.quickReplies.map((q) => q.title),
    // Only web_url buttons are editable here; see the note on the form.
    buttons: reply.buttons.filter((b) => b.type === 'web_url').map((b) => ({ title: b.title, url: b.url })),
    attachmentUrl: reply.attachmentUrl ?? '',
    attachmentType: reply.attachmentType ?? 'file',
  }
}

/** The create / update payload: blank quick replies and incomplete buttons are dropped, text trimmed. */
export function draftPayload(draft: Draft) {
  return {
    title: draft.title,
    body: draft.body,
    quickReplies: draft.quickReplies.filter((t) => t.trim()).map((t) => ({ title: t.trim(), payload: t.trim() })),
    buttons: draft.buttons
      .filter((b) => b.title.trim() && b.url.trim())
      .map((b) => ({ type: 'web_url' as const, title: b.title.trim(), url: b.url.trim() })),
    attachmentUrl: draft.attachmentUrl.trim() || null,
    attachmentType: draft.attachmentUrl.trim() ? draft.attachmentType : null,
  }
}

/**
 * The saved-reply actions return some failures as a Hebrew `detail` sentence
 * (modules/messenger/savedReplyActions.ts, lib/facebook/messenger/structured.ts —
 * unchanged). Outside Hebrew the fixed ones are worded by exact sentence; one
 * carrying a number is shown as returned.
 */
const DETAIL_KEYS: MessageKey[] = [
  'settings.messenger.replies.detail.titleRequired',
  'settings.messenger.replies.detail.quickText',
  'settings.messenger.replies.detail.buttonText',
  'settings.messenger.replies.detail.buttonHttps',
  'settings.messenger.replies.detail.fileHttps',
  'settings.messenger.replies.failure.empty',
]
const HEBREW = translatorFor('he')
const BY_DETAIL = new Map<string, MessageKey>(DETAIL_KEYS.map((key) => [HEBREW(key), key]))

export function savedReplyDetail(detail: string, t: Translator): string {
  if (t.locale === 'he') return detail
  const key = BY_DETAIL.get(detail)
  return key ? t(key) : detail
}
