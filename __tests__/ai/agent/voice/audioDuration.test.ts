import { describe, expect, it } from 'vitest'
import { probeAudioDurationMs } from '@/lib/agent/voice/audioDuration'
import { mp4, oggOpus, spuriousOggS, webm } from './audioFixtures'

/** The server-side duration probe: reads declared metadata, never trusts it as a bound, never throws. */

describe('declared durations are read from each container', () => {
  it('MP4 mvhd, version 0 and version 1', () => {
    expect(probeAudioDurationMs(mp4(95_000), 'mp4')).toBe(95_000)
    expect(probeAudioDurationMs(mp4(30 * 60_000, { version: 1 }), 'mp4')).toBe(30 * 60_000)
  })

  it('WebM Info Duration inside an unknown-size Segment', () => {
    expect(probeAudioDurationMs(webm(61_500), 'webm')).toBe(61_500)
  })

  it('Ogg Opus from the last granule position, minus pre-skip', () => {
    expect(probeAudioDurationMs(oggOpus(45_000), 'ogg')).toBeCloseTo(45_000, 0)
  })

  it('Ogg: a stray "OggS" inside the last page\'s audio is not mistaken for a page (no false 10-hour duration)', () => {
    const body = [1, 2, 3, ...spuriousOggS(), 4, 5, 6]
    expect(probeAudioDurationMs(oggOpus(45_000, 4_096, body), 'ogg')).toBeCloseTo(45_000, 0)
  })

  it('Ogg: a final page that does not end at the end of the file is not trusted', () => {
    const truncated = oggOpus(45_000, 4_096, new Array(40).fill(9)).subarray(0, 4_096 - 10)
    expect(probeAudioDurationMs(truncated, 'ogg')).toBeNull()
  })
})

describe('no usable metadata → null (unknown), never a guess', () => {
  it('Chrome-style WebM with no Duration, and fragmented MP4 declaring 0', () => {
    expect(probeAudioDurationMs(webm(null), 'webm')).toBeNull()
    expect(probeAudioDurationMs(mp4(0), 'mp4')).toBeNull()
  })

  it('a low-bitrate file: tiny, no metadata — bytes say nothing about duration', () => {
    expect(probeAudioDurationMs(webm(null, 1_100), 'webm')).toBeNull()
  })

  it('malformed metadata: truncated, garbage, impossible sizes, wrong container', () => {
    const truncated = mp4(95_000).subarray(0, 40)
    expect(probeAudioDurationMs(truncated, 'mp4')).toBeNull()
    expect(probeAudioDurationMs(new Uint8Array(4_096).fill(0xff), 'mp4')).toBeNull()
    expect(probeAudioDurationMs(new Uint8Array(4_096).fill(0xff), 'webm')).toBeNull()
    expect(probeAudioDurationMs(new Uint8Array(4_096), 'ogg')).toBeNull()
    const lying = mp4(95_000)
    lying.set([0x7f, 0xff, 0xff, 0xff], 0) // a box claiming 2 GB inside a 4 KB file
    expect(probeAudioDurationMs(lying, 'mp4')).toBeNull()
    expect(probeAudioDurationMs(webm(61_500), 'mp4')).toBeNull()
    expect(probeAudioDurationMs(new Uint8Array(0), 'webm')).toBeNull()
  })

  it('non-finite or negative declared durations are not durations', () => {
    expect(probeAudioDurationMs(webm(Number.NaN), 'webm')).toBeNull()
    expect(probeAudioDurationMs(webm(-5), 'webm')).toBeNull()
  })
})
