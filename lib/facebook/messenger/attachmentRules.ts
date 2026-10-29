import type { MessengerAttachmentType } from '@/lib/facebook/messenger/parseMessagingEvent'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * What may be sent as a Messenger attachment — pure, no Node APIs, safe in a
 * client bundle so the composer rejects a bad file BEFORE uploading it and the
 * server enforces the identical rule afterwards.
 *
 * LIMITS per https://developers.facebook.com/docs/messenger-platform/send-messages/saving-assets
 * (checked 2026-09-23): 25 MB maximum across asset types. The documented 8 MB
 * image ceiling applies to URL uploads; SocialCRM streams the bytes directly,
 * so the 25 MB limit is the one that binds. It is enforced BELOW Meta's number,
 * not at it — a file Meta would reject at the boundary costs the rep an upload
 * and gives back an error nobody can act on.
 *
 * TYPE IS DECIDED BY MIME, NOT BY FILE EXTENSION. An extension is attacker- (and
 * typo-) controlled; the browser-reported MIME is what Meta is told, and the
 * server re-derives it rather than trusting a client-sent category.
 */

export const MESSENGER_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

/** Meta's four sendable asset types. `share`/`unsupported` are receive-only. */
export type MessengerSendableType = Extract<MessengerAttachmentType, 'image' | 'video' | 'audio' | 'file'>

/**
 * Formats Meta accepts and a browser can actually render back in the thread.
 * Anything else that is otherwise legal still goes as a generic `file`.
 */
const IMAGE = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const VIDEO = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp']
const AUDIO = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm']

/**
 * Executable and script types are refused outright. Messenger would deliver
 * them, but SocialCRM will not be the tool that sends a customer a .exe.
 */
const BLOCKED = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-executable',
  'application/vnd.microsoft.portable-executable',
  'application/x-dosexec',
  'text/javascript',
  'application/javascript',
  'application/x-httpd-php',
]

const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|sh|ps1|jar|apk|dll|js|php|vbs)$/i

export type AttachmentRejection = 'empty' | 'too_large' | 'blocked_type'

/**
 * Narrowed with `'reason' in check`, not `check.ok`: this project compiles with
 * strictNullChecks off, where a boolean-literal discriminant does not narrow.
 */
export type AttachmentCheck = { type: MessengerSendableType } | { reason: AttachmentRejection }

/** Meta's asset type for a MIME string. Unknown-but-allowed becomes `file`. */
export function messengerAssetType(mime: string): MessengerSendableType {
  const m = (mime || '').toLowerCase().split(';')[0].trim()
  if (IMAGE.includes(m)) return 'image'
  if (VIDEO.includes(m)) return 'video'
  if (AUDIO.includes(m)) return 'audio'
  return 'file'
}

/**
 * The single validation both sides run. `name` is only consulted to refuse
 * dangerous extensions — it never decides the asset type.
 */
export function checkMessengerAttachment(file: { size: number; type: string; name: string }): AttachmentCheck {
  if (!file || file.size <= 0) return { reason: 'empty' }
  if (file.size > MESSENGER_ATTACHMENT_MAX_BYTES) return { reason: 'too_large' }
  const mime = (file.type || '').toLowerCase().split(';')[0].trim()
  if (BLOCKED.includes(mime) || BLOCKED_EXT.test(file.name || '')) return { reason: 'blocked_type' }
  return { type: messengerAssetType(mime) }
}

/**
 * Hebrew copy for a rejection. Says the limit, so the rep can act on it. The
 * upload route answers with it (`detail`); the composer reads
 * `attachmentRejectionCopy`, which is this same text in Hebrew.
 */
export const ATTACHMENT_REJECTION_COPY: Record<AttachmentRejection, string> = {
  empty: 'הקובץ ריק',
  too_large: 'הקובץ גדול מדי. המגבלה היא 25MB.',
  blocked_type: 'לא ניתן לשלוח קובץ מסוג זה',
}

const REJECTION_KEYS = {
  empty: 'inbox.messenger.attachment.empty',
  too_large: 'inbox.messenger.attachment.too_large',
  blocked_type: 'inbox.messenger.attachment.blocked_type',
} as const

/** A rejection in the interface language, by its code. Hebrew is `ATTACHMENT_REJECTION_COPY`. */
export function attachmentRejectionCopy(reason: AttachmentRejection, locale: UiLocale = 'he'): string {
  return locale === 'he' ? ATTACHMENT_REJECTION_COPY[reason] : translatorFor(locale)(REJECTION_KEYS[reason])
}
