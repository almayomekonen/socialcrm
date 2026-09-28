/**
 * The shared rules of /agent voice input: which audio is accepted, how it is
 * recognised from its bytes, which format a browser records in, and how a
 * transcript joins a draft without destroying it.
 */
import { describe, expect, it } from 'vitest'
import {
  VOICE_MAX_RECORDING_MS,
  VOICE_MAX_UPLOAD_BYTES,
  VOICE_MIN_UPLOAD_BYTES,
  containerFromMimeType,
  formatRecordingTime,
  mergeTranscriptIntoDraft,
  pickRecorderMimeType,
  sniffContainer,
} from '@/lib/agent/voice/limits'

const bytes = (head: number[], len = 64) => {
  const b = new Uint8Array(len)
  b.set(head)
  return b
}
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3])
const OGG = bytes([0x4f, 0x67, 0x67, 0x53])
const MP4 = bytes([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])
const PDF = bytes([0x25, 0x50, 0x44, 0x46])
const PNG = bytes([0x89, 0x50, 0x4e, 0x47])

describe('limits are conservative and consistent', () => {
  it('two minutes, under the platform body ceiling, and a floor for empty recordings', () => {
    expect(VOICE_MAX_RECORDING_MS).toBe(120_000)
    expect(VOICE_MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024)
    expect(VOICE_MIN_UPLOAD_BYTES).toBeGreaterThan(0)
  })
})

describe('declared type → container', () => {
  it('accepts what browsers record, ignoring codec parameters', () => {
    expect(containerFromMimeType('audio/webm;codecs=opus')).toBe('webm')
    expect(containerFromMimeType('AUDIO/WEBM')).toBe('webm')
    expect(containerFromMimeType('audio/mp4')).toBe('mp4')
    expect(containerFromMimeType('audio/x-m4a')).toBe('mp4')
    expect(containerFromMimeType('audio/ogg; codecs=opus')).toBe('ogg')
  })

  it('refuses everything else', () => {
    for (const t of ['text/plain', 'application/json', 'image/png', 'application/pdf', 'audio/wav', 'multipart/form-data', '', null, undefined]) {
      expect(containerFromMimeType(t as string), String(t)).toBeNull()
    }
  })
})

describe('bytes → container (the check behind the declared type)', () => {
  it('recognises WebM, Ogg and MP4 by signature', () => {
    expect(sniffContainer(WEBM)).toBe('webm')
    expect(sniffContainer(OGG)).toBe('ogg')
    expect(sniffContainer(MP4)).toBe('mp4')
  })

  it('refuses non-audio files and fragments', () => {
    expect(sniffContainer(PDF)).toBeNull()
    expect(sniffContainer(PNG)).toBeNull()
    expect(sniffContainer(new Uint8Array(4))).toBeNull()
    expect(sniffContainer(new Uint8Array(0))).toBeNull()
  })
})

describe('recorder format is chosen at runtime', () => {
  it('Chrome-like: WebM/Opus first', () => {
    expect(pickRecorderMimeType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
  })
  it('Safari-like: no WebM, MP4 chosen', () => {
    expect(pickRecorderMimeType((t) => t.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2')
  })
  it('Firefox-like with only Ogg', () => {
    expect(pickRecorderMimeType((t) => t.startsWith('audio/ogg'))).toBe('audio/ogg;codecs=opus')
  })
  it('nothing supported → null (the recorder default is used); a throwing probe is not fatal', () => {
    expect(pickRecorderMimeType(() => false)).toBeNull()
    expect(pickRecorderMimeType(() => { throw new Error('boom') })).toBeNull()
  })
})

describe('a transcript never destroys the draft', () => {
  it('fills an empty box', () => {
    expect(mergeTranscriptIntoDraft('', 'תיצור לי משימה')).toBe('תיצור לי משימה')
    expect(mergeTranscriptIntoDraft('   ', 'שלום')).toBe('שלום')
  })
  it('appends after existing text, with exactly one space', () => {
    expect(mergeTranscriptIntoDraft('לדני כהן', 'לחזור מחר')).toBe('לדני כהן לחזור מחר')
    expect(mergeTranscriptIntoDraft('לדני כהן ', 'לחזור מחר')).toBe('לדני כהן לחזור מחר')
    expect(mergeTranscriptIntoDraft('call Dani', 'מחר ב-10')).toBe('call Dani מחר ב-10')
  })
  it('an empty transcript leaves the draft exactly as it was', () => {
    expect(mergeTranscriptIntoDraft('טיוטה', '   ')).toBe('טיוטה')
  })
})

describe('timer format', () => {
  it('m:ss', () => {
    expect(formatRecordingTime(0)).toBe('0:00')
    expect(formatRecordingTime(9_400)).toBe('0:09')
    expect(formatRecordingTime(65_000)).toBe('1:05')
    expect(formatRecordingTime(VOICE_MAX_RECORDING_MS)).toBe('2:00')
  })
})
