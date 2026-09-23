import type { MessengerSendableType } from '@/lib/facebook/messenger/attachmentRules'

/**
 * Structured Messenger messages: quick replies, the button template, and the
 * generic template.
 *
 * PURE — no DB, no Graph, safe in a client bundle, so the composer validates
 * against exactly the rules the server enforces.
 *
 * LIMITS are Meta's, checked 2026-09-23:
 *  · quick replies — https://developers.facebook.com/docs/messenger-platform/send-messages/quick-replies
 *      up to 13, title ≤ 20 chars, payload ≤ 1000
 *  · button template — .../send-messages/template/button
 *      text ≤ 640 chars, 1–3 buttons
 *  · generic template — .../send-messages/template/generic
 *      ≤ 10 elements, title/subtitle ≤ 80, ≤ 3 buttons per element
 *
 * They are enforced HERE rather than left to Meta because Meta's refusal is an
 * opaque code after a round trip, and the rep who wrote a 25-character button
 * needs to be told that, not "פייסבוק לא אישר".
 */

export const QUICK_REPLY_MAX = 13
export const QUICK_REPLY_TITLE_MAX = 20
export const QUICK_REPLY_PAYLOAD_MAX = 1000
export const BUTTON_TEMPLATE_TEXT_MAX = 640
export const BUTTONS_MAX = 3
export const BUTTON_TITLE_MAX = 20
export const GENERIC_MAX_ELEMENTS = 10
export const GENERIC_TITLE_MAX = 80

export type MessengerQuickReply = { title: string; payload: string }

/**
 * Only `postback` and `web_url`. Meta has more (call, log-in, share…), each with
 * its own eligibility; none is needed to answer a customer, and offering one we
 * cannot verify would be a dead control.
 */
export type MessengerButton =
  | { type: 'postback'; title: string; payload: string }
  | { type: 'web_url'; title: string; url: string }

export type MessengerGenericElement = {
  title: string
  subtitle?: string
  imageUrl?: string
  buttons?: MessengerButton[]
}

/** What a send may carry beyond plain text. */
export type MessengerRichContent = {
  quickReplies?: MessengerQuickReply[]
  buttons?: MessengerButton[]
  elements?: MessengerGenericElement[]
  attachment?: { type: MessengerSendableType; url: string }
}

export type StructuredValidation = { error: string } | { ok: true }

function trimmed(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Meta fetches these itself, so they must be absolute and reachable. */
export function isSendableUrl(url: unknown): boolean {
  const s = trimmed(url)
  if (!s.startsWith('https://')) return false
  try {
    const parsed = new URL(s)
    // A URL Meta cannot resolve is a send that fails at Meta with an opaque
    // code; a hostname with no dot is never publicly resolvable.
    return parsed.hostname.includes('.')
  } catch {
    return false
  }
}

/**
 * One validator for everything structured. Returns Hebrew the rep can act on,
 * naming the limit that was exceeded.
 */
export function validateRichContent(content: MessengerRichContent): StructuredValidation {
  const quick = content.quickReplies ?? []
  if (quick.length > QUICK_REPLY_MAX) return { error: `אפשר עד ${QUICK_REPLY_MAX} תשובות מהירות` }
  for (const q of quick) {
    if (!trimmed(q?.title)) return { error: 'לכל תשובה מהירה צריך טקסט' }
    if (trimmed(q.title).length > QUICK_REPLY_TITLE_MAX) {
      return { error: `טקסט של תשובה מהירה ארוך מדי (עד ${QUICK_REPLY_TITLE_MAX} תווים)` }
    }
    if (trimmed(q.payload).length > QUICK_REPLY_PAYLOAD_MAX) return { error: 'ערך התשובה המהירה ארוך מדי' }
  }

  const checkButtons = (buttons: MessengerButton[] | undefined, where: string): string | null => {
    const list = buttons ?? []
    if (list.length > BUTTONS_MAX) return `אפשר עד ${BUTTONS_MAX} כפתורים ${where}`
    for (const b of list) {
      if (!trimmed(b?.title)) return 'לכל כפתור צריך טקסט'
      if (trimmed(b.title).length > BUTTON_TITLE_MAX) {
        return `טקסט של כפתור ארוך מדי (עד ${BUTTON_TITLE_MAX} תווים)`
      }
      if (b.type === 'web_url' && !isSendableUrl(b.url)) return 'כתובת הקישור בכפתור חייבת להתחיל ב-https'
      if (b.type === 'postback' && !trimmed(b.payload)) return 'לכפתור פעולה צריך ערך'
    }
    return null
  }

  const buttonsError = checkButtons(content.buttons, 'בהודעה')
  if (buttonsError) return { error: buttonsError }

  const elements = content.elements ?? []
  if (elements.length > GENERIC_MAX_ELEMENTS) return { error: `אפשר עד ${GENERIC_MAX_ELEMENTS} כרטיסים` }
  for (const e of elements) {
    if (!trimmed(e?.title)) return { error: 'לכל כרטיס צריך כותרת' }
    if (trimmed(e.title).length > GENERIC_TITLE_MAX) {
      return { error: `כותרת כרטיס ארוכה מדי (עד ${GENERIC_TITLE_MAX} תווים)` }
    }
    if (e.subtitle && trimmed(e.subtitle).length > GENERIC_TITLE_MAX) {
      return { error: `תיאור כרטיס ארוך מדי (עד ${GENERIC_TITLE_MAX} תווים)` }
    }
    if (e.imageUrl && !isSendableUrl(e.imageUrl)) return { error: 'כתובת תמונה בכרטיס חייבת להתחיל ב-https' }
    const elementButtons = checkButtons(e.buttons, 'בכרטיס')
    if (elementButtons) return { error: elementButtons }
  }

  // A message with buttons AND cards is two different templates at once; Meta
  // takes one `attachment`, so the caller must choose.
  if (content.buttons?.length && content.elements?.length) {
    return { error: 'אפשר לשלוח כפתורים או כרטיסים, לא את שניהם באותה הודעה' }
  }
  if (content.attachment && (content.buttons?.length || content.elements?.length)) {
    return { error: 'אפשר לשלוח קובץ מצורף או תבנית, לא את שניהם באותה הודעה' }
  }
  if (content.attachment && !isSendableUrl(content.attachment.url)) {
    return { error: 'כתובת הקובץ חייבת להתחיל ב-https' }
  }

  return { ok: true }
}

function mapButtons(buttons: MessengerButton[]): Record<string, unknown>[] {
  return buttons.slice(0, BUTTONS_MAX).map((b) =>
    b.type === 'web_url'
      ? { type: 'web_url', title: trimmed(b.title).slice(0, BUTTON_TITLE_MAX), url: trimmed(b.url) }
      : {
          type: 'postback',
          title: trimmed(b.title).slice(0, BUTTON_TITLE_MAX),
          payload: trimmed(b.payload).slice(0, QUICK_REPLY_PAYLOAD_MAX),
        },
  )
}

/**
 * The `message` object for a send.
 *
 * Meta allows exactly one of `text` and `attachment`, and `quick_replies` rides
 * on either. `validateRichContent` has already rejected the combinations that
 * cannot be expressed; this function does not re-litigate them, it just builds.
 *
 * Returns null when there is nothing to send — a caller that would otherwise
 * post an empty message and get an opaque refusal.
 */
export function buildMessengerMessage(text: string, content: MessengerRichContent = {}): Record<string, unknown> | null {
  const body = trimmed(text)
  const message: Record<string, unknown> = {}

  if (content.elements?.length) {
    message.attachment = {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: content.elements.slice(0, GENERIC_MAX_ELEMENTS).map((e) => ({
          title: trimmed(e.title).slice(0, GENERIC_TITLE_MAX),
          ...(e.subtitle ? { subtitle: trimmed(e.subtitle).slice(0, GENERIC_TITLE_MAX) } : {}),
          ...(e.imageUrl ? { image_url: trimmed(e.imageUrl) } : {}),
          ...(e.buttons?.length ? { buttons: mapButtons(e.buttons) } : {}),
        })),
      },
    }
  } else if (content.buttons?.length) {
    // The button template REQUIRES text; there is nothing to attach buttons to
    // otherwise.
    if (!body) return null
    message.attachment = {
      type: 'template',
      payload: {
        template_type: 'button',
        text: body.slice(0, BUTTON_TEMPLATE_TEXT_MAX),
        buttons: mapButtons(content.buttons),
      },
    }
  } else if (content.attachment) {
    message.attachment = {
      type: content.attachment.type,
      // `url`, not `attachment_id`: a reusable attachment_id EXPIRES after 90
      // days (Meta, Saving Assets), which would make a saved reply quietly stop
      // working three months after it was written. A URL the business controls
      // does not expire, and Meta fetches it per send.
      payload: { url: trimmed(content.attachment.url), is_reusable: false },
    }
  } else if (body) {
    message.text = body
  } else {
    return null
  }

  const quick = (content.quickReplies ?? []).filter((q) => trimmed(q?.title))
  if (quick.length > 0) {
    message.quick_replies = quick.slice(0, QUICK_REPLY_MAX).map((q) => ({
      content_type: 'text',
      title: trimmed(q.title).slice(0, QUICK_REPLY_TITLE_MAX),
      // Meta requires a payload for a text quick reply; the title is the
      // sensible default and is what the postback will read back as.
      payload: (trimmed(q.payload) || trimmed(q.title)).slice(0, QUICK_REPLY_PAYLOAD_MAX),
    }))
  }

  return message
}

/** True when this send carries more than plain text — used for logging and previews. */
export function isStructured(content: MessengerRichContent): boolean {
  return Boolean(
    content.quickReplies?.length || content.buttons?.length || content.elements?.length || content.attachment,
  )
}

/** A short Hebrew description of what was sent, for the conversation preview. */
export function describeRichContent(text: string, content: MessengerRichContent): string {
  if (trimmed(text)) return trimmed(text)
  if (content.elements?.length) return '[כרטיסים]'
  if (content.attachment) return '[קובץ מצורף]'
  return ''
}
