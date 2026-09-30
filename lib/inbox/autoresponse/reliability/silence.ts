import { isGreetingOnly, isLowInformationInbound } from '../gptEligibility'
import { inboundContainsRealQuestion } from '../conversationControl'
import { withGreeting } from '../greeting'
import { metadataSource } from './ownership'

/**
 * When the agent must not stay silent, and what it says instead. Pure.
 *
 * Two situations used to end in silence with no signal to anyone:
 *
 *   1. MEDIA ONLY. A photo, document, video or voice note persists with empty
 *      `text`, so the turn read as LOW_INFORMATION and the job was skipped. The
 *      customer who sent the photo of the problem heard nothing.
 *   2. AN OPENER. The first message was only a greeting or an emoji ("היי",
 *      "👋", "?"). A bare greeting reached the model just to be greeted back;
 *      emoji and punctuation were skipped outright.
 *
 * Both now get a deterministic line, written here, with no model call. Neither
 * claims to have understood anything: the media acknowledgement says we
 * received it and asks for words.
 *
 * DELIBERATELY SILENT: stickers, reactions, contacts, locations and unknown
 * events. Answering every WhatsApp event is noise, and a reaction to our own
 * message is not a question.
 */

export type InboundRow = {
  direction: string
  type?: string | null
  text?: string | null
  payload?: unknown
}

const CAPTIONED_TYPES = new Set(['image', 'document', 'video'])
const VISUAL_MEDIA = new Set(['image', 'document', 'video'])

/**
 * The text the agent can read: the message text, or — for an image, document
 * or video — its caption. The caption is already stored in `payload` (the raw
 * WhatsApp content object); `text` itself is left untouched so the inbox and
 * the questionnaire read exactly what they read before.
 */
export function readableInboundText(m: InboundRow): string {
  const text = String(m.text ?? '').trim()
  if (text) return text
  if (!CAPTIONED_TYPES.has(String(m.type ?? ''))) return ''
  const payload = (typeof m.payload === 'string' ? safeParse(m.payload) : m.payload) as { caption?: unknown } | null
  const caption = payload?.caption
  return typeof caption === 'string' ? caption.trim() : ''
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export type MediaOnlyKind = 'voice' | 'visual'

/**
 * The customer's pending messages are media we cannot read, and nothing else.
 * `voice` when any of them is audio, `visual` for image/document/video. Null
 * when anything readable is pending, or when the only pending items are things
 * that deserve silence (sticker, reaction, location, contacts, unknown).
 */
export function mediaOnlyKind(pending: readonly InboundRow[]): MediaOnlyKind | null {
  if (!pending.length) return null
  if (pending.some((m) => readableInboundText(m))) return null
  const types = pending.map((m) => String(m.type ?? ''))
  if (types.includes('audio')) return 'voice'
  if (types.some((t) => VISUAL_MEDIA.has(t))) return 'visual'
  return null
}

/** Only a greeting, an emoji, or punctuation — nothing to answer but hello. */
export function isOpenerOnly(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  // Emoji / punctuation / a single letter: nothing to answer but hello — a lone
  // "?" is not a question we could answer.
  if (isLowInformationInbound(t)) return true
  return isGreetingOnly(t) && !inboundContainsRealQuestion(t)
}

/** Every pending customer text is an opener (and there is at least one). */
export function allOpeners(pendingTexts: readonly string[]): boolean {
  const texts = pendingTexts.map((t) => (t ?? '').trim()).filter(Boolean)
  return texts.length > 0 && texts.every(isOpenerOnly)
}

export const OPENING_KIND = 'opening'
export const MEDIA_ACK_KIND = 'media_ack'

export function openingQuestion(lang: 'he' | 'en'): string {
  return lang === 'en' ? 'How can I help?' : 'איך אפשר לעזור?'
}

export function mediaAcknowledgement(kind: MediaOnlyKind, lang: 'he' | 'en'): string {
  if (lang === 'en') {
    return kind === 'voice'
      ? "Got your voice message. I can't listen to recordings here yet, could you write it in a few words?"
      : 'Got it, thank you. Could you write in a few words what you need?'
  }
  return kind === 'voice'
    ? 'קיבלתי את ההקלטה. כרגע אין לי אפשרות להאזין להקלטות כאן, אפשר לכתוב לי בכמה מילים?'
    : 'קיבלתי, תודה. אפשר לכתוב לי בכמה מילים במה מדובר?'
}

/**
 * Our last outbound was already a media acknowledgement and the customer has
 * still written nothing readable: do not acknowledge a second photo.
 */
export function lastOutboundWasMediaAck(lastOutbound: { metadata?: unknown } | null | undefined): boolean {
  if (!lastOutbound) return false
  try {
    const m = typeof lastOutbound.metadata === 'string' ? JSON.parse(lastOutbound.metadata) : lastOutbound.metadata
    return (m as { kind?: unknown } | null)?.kind === MEDIA_ACK_KIND && metadataSource(m) === 'auto_response'
  } catch {
    return false
  }
}

export type DeterministicTurn =
  | { kind: typeof OPENING_KIND; text: string }
  | { kind: typeof MEDIA_ACK_KIND; text: string; media: MediaOnlyKind }

/**
 * The deterministic turn owed for these pending messages, or null to fall
 * through to the ordinary pipeline.
 *
 * `firstContact` must mean the agent has never spoken here AND no outbound of
 * any kind exists — the same durable facts the greeting uses — so an opener in
 * the middle of a conversation is still read by the ordinary engaged gate.
 */
export function decideDeterministicTurn(args: {
  pending: readonly InboundRow[]
  firstContact: boolean
  greetingLine: string | null
  lang: 'he' | 'en'
  lastOutbound: { metadata?: unknown } | null | undefined
}): DeterministicTurn | null {
  const media = mediaOnlyKind(args.pending)
  if (media) {
    if (lastOutboundWasMediaAck(args.lastOutbound)) return null
    return { kind: MEDIA_ACK_KIND, media, text: withGreeting(args.greetingLine, mediaAcknowledgement(media, args.lang)) }
  }
  if (!args.firstContact || !args.greetingLine) return null
  const texts = args.pending.map((m) => readableInboundText(m))
  if (!allOpeners(texts)) return null
  return { kind: OPENING_KIND, text: withGreeting(args.greetingLine, openingQuestion(args.lang)) }
}
