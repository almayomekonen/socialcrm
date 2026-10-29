import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

const he = translatorFor('he')

/**
 * Pure display helpers for inbound WhatsApp media. No React, no data access —
 * both the desktop thread and the mobile bubble import these so the two
 * surfaces cannot drift in what they call a file or how they label it.
 */

/** Shown instead of an empty bubble for a message we cannot render yet (Hebrew; readers in a translated region use the catalog key). */
export const UNSUPPORTED_MESSAGE_NOTICE = he('inbox.media.unsupported')

/** Shown when a file arrived without a filename. */
export const UNNAMED_ATTACHMENT_LABEL = he('inbox.media.unnamedFile')

const KIND_BY_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
}

/**
 * Short, human label for the file type. Falls back to the mime top-level group
 * so an unknown subtype still says something true rather than nothing.
 */
export function fileKindLabel(mimeType: string | null | undefined, locale: UiLocale = 'he'): string | null {
  if (!mimeType) return null
  const exact = KIND_BY_MIME[mimeType]
  if (exact) return exact
  const [group, subtype] = mimeType.split('/')
  const t = translatorFor(locale)
  if (group === 'image') return t('inbox.media.kindImage')
  if (group === 'audio') return t('inbox.media.kindAudio')
  if (group === 'video') return t('inbox.media.kindVideo')
  return subtype ? subtype.toUpperCase().slice(0, 12) : null
}

/**
 * Should this attachment be shown AS the picture rather than as a file card?
 *
 * The distinction is the whole point of the media UX: an image message is an
 * image, not a generic download. Keyed on the mime group already carried in the
 * safe client shape, so no extra data is exposed to decide it.
 */
export function isImageAttachment(mimeType: string | null | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.startsWith('image/')
}

/**
 * Should this attachment be played rather than downloaded?
 *
 * Every audio message seen in production is a WhatsApp voice note —
 * `audio/ogg; codecs=opus`, 241 of 241, all carrying `voice: true` in the raw
 * payload. That flag is NOT part of the safe client shape and is not needed
 * here: a voice note and an ordinary audio file both want a player, so the mime
 * group alone decides. The existing mime sanitiser has already stripped the
 * `; codecs=opus` parameter by this point.
 */
export function isAudioAttachment(mimeType: string | null | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.startsWith('audio/')
}

/** Shown for a voice note, which WhatsApp sends with no filename at all. */
export const UNNAMED_AUDIO_LABEL = he('inbox.media.unnamedAudio')

/**
 * A duration we can actually put on a progress bar.
 *
 * `HTMLMediaElement.duration` is `NaN` before metadata and, for a response
 * served without Range support, frequently `Infinity` until the whole file has
 * been buffered — which is exactly what the WhatsApp media route sends. The old
 * code collapsed anything non-finite to 0, which disabled the seek bar and froze
 * the readout at `0:00 / 0:00` while the audio played on. Falling back to the
 * browser's own seekable end recovers a usable length in that case.
 */
export function resolveMediaDuration(rawDuration: number, seekableEnd: number): number {
  if (Number.isFinite(rawDuration) && rawDuration > 0) return rawDuration
  if (Number.isFinite(seekableEnd) && seekableEnd > 0) return seekableEnd
  return 0
}

/**
 * Keep a playback position inside the track. Guards the progress control against
 * ever receiving NaN, Infinity or a value past the end — any of which make a
 * range input render at a nonsense position.
 */
export function clampPlaybackTime(time: number, duration: number): number {
  if (!Number.isFinite(time) || time < 0) return 0
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(time, duration)
}

/** Authenticated download path for a message's media. */
export function attachmentHref(messageId: number): string {
  return `/api/whatsapp/media/${messageId}`
}
