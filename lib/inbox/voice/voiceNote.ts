import { sniffContainer } from '@/lib/agent/voice/limits'

/**
 * A customer's WhatsApp voice note, as the agent reads it. Pure, no I/O.
 *
 * The transcript lives on the audio message's own row, in
 * `inbox_messages.payload.transcription` (no schema change). `text` is never
 * touched, so the inbox, the questionnaire and the opt-out reader see exactly
 * what they saw before. Only the agent's turn reads the transcript, through
 * `voiceTranscriptOf`.
 *
 * Universal: nothing here, or in the step that fills it, knows an agency id.
 */

/** WhatsApp's own ceiling for audio media is 16 MB. */
export const VOICE_NOTE_MAX_BYTES = 16 * 1024 * 1024
/** Anything smaller is not speech. */
export const VOICE_NOTE_MIN_BYTES = 1_024
/** Longest voice note transcribed. Longer ones get the "please write" fallback. */
export const VOICE_NOTE_MAX_MS = 5 * 60_000
/** Voice notes transcribed in one turn at most; a flood of recordings cannot fan out paid calls. */
export const VOICE_NOTES_PER_TURN = 3
/** Longest transcript kept. Five minutes of speech is well under it. */
export const VOICE_TRANSCRIPT_MAX_CHARS = 4_000
/** Each Graph hop (lookup, then file). */
export const VOICE_DOWNLOAD_TIMEOUT_MS = 8_000
export const VOICE_TRANSCRIBE_TIMEOUT_MS = 15_000
/**
 * Wall clock for ALL voice work in one turn. The webhook's after() and the cron
 * both run the agent inside a 60 s function that still has to generate and send
 * the reply; a function killed mid-transcription would leave the note without a
 * result and redo it on every recovery. Every step's timeout is cut to what is
 * left of this budget.
 */
export const VOICE_TURN_BUDGET_MS = 20_000
/** Not worth starting a note with less than this left. */
export const VOICE_MIN_STEP_MS = 3_000

/** Formats the transcription provider accepts. WhatsApp's AMR and raw AAC are not among them. */
export type VoiceNoteFormat = 'ogg' | 'mp4' | 'webm' | 'mp3'

export const VOICE_NOTE_MEDIA_TYPE: Record<VoiceNoteFormat, string> = {
  ogg: 'audio/ogg',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
}

/**
 * What the BYTES are, never what the sender declared. WhatsApp voice notes are
 * Ogg/Opus. MP3 is an ID3 tag or an MPEG audio frame sync whose layer bits are
 * not 00 (00 is ADTS AAC, which the provider does not take).
 */
export function sniffVoiceNote(bytes: Uint8Array): VoiceNoteFormat | null {
  const c = sniffContainer(bytes)
  if (c) return c
  if (bytes.length < 4) return null
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'mp3'
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && ((bytes[1] >> 1) & 0x03) !== 0) return 'mp3'
  return null
}

export type VoiceTranscription =
  | { status: 'ok'; text: string; model: string; at: string }
  | { status: 'empty' | 'unsupported' | 'too_long' | 'too_large' | 'failed'; code: string; model: string | null; at: string }

export type VoiceRow = { type?: string | null; payload?: unknown }

function payloadOf(row: VoiceRow): Record<string, unknown> | null {
  const p = typeof row.payload === 'string' ? safeParse(row.payload) : row.payload
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export function transcriptionOf(row: VoiceRow): VoiceTranscription | null {
  if (row.type !== 'audio') return null
  const t = payloadOf(row)?.transcription as VoiceTranscription | undefined
  return t && typeof t === 'object' && typeof t.status === 'string' ? t : null
}

/** The customer's words, when the recording was understood. Empty string otherwise. */
export function voiceTranscriptOf(row: VoiceRow): string {
  const t = transcriptionOf(row)
  return t?.status === 'ok' && typeof t.text === 'string' ? t.text.trim() : ''
}

/** A voice note we TRIED to understand and could not. Never true for one not attempted. */
export function isVoiceUnclear(row: VoiceRow): boolean {
  const t = transcriptionOf(row)
  return !!t && t.status !== 'ok'
}

/** The WhatsApp media id the recording is fetched by. */
export function voiceMediaIdOf(row: VoiceRow): string {
  const id = payloadOf(row)?.id
  return typeof id === 'string' ? id.trim() : ''
}

/** Speech has letters or digits. Punctuation-only output is treated as nothing said. */
export function isMeaningfulTranscript(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text ?? '')
}

/**
 * Vocabulary hint for the provider, not an instruction. No `language` is set,
 * so the provider detects it: Hebrew, English, Arabic, Russian and code-switched
 * speech all come back in the language spoken.
 */
export function customerVoicePrompt(businessName: string | null): string {
  const name = (businessName ?? '').trim().slice(0, 80)
  return [
    'הודעה קולית מלקוח לעסק בוואטסאפ. הלקוח עשוי לדבר בעברית או בשפה אחרת.',
    'יש לשמור בדיוק על שמות, סכומים, תאריכים, שעות, כתובות ומספרי טלפון.',
    name ? `שם העסק: ${name}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
