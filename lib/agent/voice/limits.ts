/**
 * Voice input for /agent — the rules both sides of the wire share.
 *
 * Voice is an INPUT METHOD, nothing more: a recording becomes text in the
 * composer, and the rep sends that text the same way they would send typed
 * text. Nothing in this module (or anywhere in the voice path) knows about
 * tools, actions, intent or approval.
 *
 * Isomorphic on purpose — no server-only imports — so the recorder in the
 * browser and the route on the server enforce the same numbers.
 */

/** Longest recording the composer accepts. The recorder stops itself here. */
export const VOICE_MAX_RECORDING_MS = 120_000

/**
 * Largest upload the transcription route reads.
 *
 * Kept under Vercel's 4.5MB request-body ceiling so an oversized body is
 * refused by this code, with a message, rather than by the platform. Two
 * minutes of browser audio is far below it: Opus/WebM runs ~0.5MB, Safari's
 * AAC/MP4 ~1–2MB.
 */
export const VOICE_MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/** Anything smaller is a failed or empty recording, not speech. */
export const VOICE_MIN_UPLOAD_BYTES = 1_024

/** Wall clock for the provider call, inside the route's maxDuration. */
export const VOICE_TRANSCRIBE_TIMEOUT_MS = 40_000

/**
 * The containers browsers' MediaRecorder actually produces, and nothing else.
 * Chrome/Edge/Firefox: WebM (Opus). Safari (macOS and iOS): MP4 (AAC).
 * Firefox may also offer Ogg (Opus).
 */
export type VoiceContainer = 'webm' | 'mp4' | 'ogg'

/** The media type sent to the provider for each container (drives the file extension). */
export const VOICE_CONTAINER_MEDIA_TYPE: Record<VoiceContainer, string> = {
  webm: 'audio/webm',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
}

/**
 * Recorder formats in order of preference. Chosen at RUNTIME via
 * `MediaRecorder.isTypeSupported` — never assumed — because support differs by
 * browser: Safari has no WebM recording, Chrome has no MP4 on older versions.
 */
export const VOICE_RECORDER_MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const

/** The first preferred format this browser can record, or null (then the recorder's default is used). */
export function pickRecorderMimeType(isTypeSupported: (mime: string) => boolean): string | null {
  for (const mime of VOICE_RECORDER_MIME_PREFERENCE) {
    try {
      if (isTypeSupported(mime)) return mime
    } catch {
      /* a throwing probe means "not this one" */
    }
  }
  return null
}

/** Map a declared Content-Type to a container, ignoring codec parameters. Null when not accepted. */
export function containerFromMimeType(mime: string | null | undefined): VoiceContainer | null {
  const base = String(mime ?? '').split(';')[0].trim().toLowerCase()
  if (base === 'audio/webm' || base === 'video/webm') return 'webm'
  if (base === 'audio/mp4' || base === 'audio/x-m4a' || base === 'audio/m4a' || base === 'video/mp4') return 'mp4'
  if (base === 'audio/ogg' || base === 'application/ogg') return 'ogg'
  return null
}

/**
 * The container the BYTES actually are, from their signature — the upload's
 * declared type is a claim, this is the check. Null for anything else, so an
 * arbitrary file relabelled `audio/webm` is refused before it reaches a
 * provider.
 *
 *   WebM  — EBML header        1A 45 DF A3
 *   Ogg   — capture pattern    "OggS"
 *   MP4   — box type at 4..8   "ftyp"
 */
export function sniffContainer(bytes: Uint8Array): VoiceContainer | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm'
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'ogg'
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'mp4'
  return null
}

/**
 * Put a transcript into the composer WITHOUT destroying what is already there.
 *
 * An existing draft is kept and the transcript is appended after it, separated
 * by a single space (or nothing, if the draft already ends in whitespace). The
 * rep still sees, edits and sends the result themselves.
 */
export function mergeTranscriptIntoDraft(draft: string, transcript: string): string {
  const t = transcript.trim()
  if (!t) return draft
  if (!draft.trim()) return t
  return /\s$/.test(draft) ? draft + t : `${draft} ${t}`
}

/** `m:ss` for the recording timer. */
export function formatRecordingTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
