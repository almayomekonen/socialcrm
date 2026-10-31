/**
 * Minimal, structurally valid audio containers for the duration probe and the
 * route: just the metadata a probe reads, padded with filler "media".
 */

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const pad = (head: number[], len: number) => {
  const b = new Uint8Array(Math.max(len, head.length))
  b.set(head)
  return b
}

const box = (type: string, payload: number[]) => [...u32(8 + payload.length), ...ascii(type), ...payload]

/** MP4 with moov/mvhd declaring `durationMs` (version 0, or 1 = 64-bit fields). 0 = "unknown" (fragmented). */
export function mp4(durationMs: number, opts: { version?: 0 | 1; len?: number } = {}): Uint8Array<ArrayBuffer> {
  const timescale = 1000
  const mvhd =
    opts.version === 1
      ? box('mvhd', [
          1,
          0,
          0,
          0,
          ...u32(0),
          ...u32(0),
          ...u32(0),
          ...u32(0),
          ...u32(timescale),
          ...u32(0),
          ...u32(durationMs),
          ...new Array(80).fill(0),
        ])
      : box('mvhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(durationMs), ...new Array(80).fill(0)])
  const head = [...box('ftyp', [...ascii('isom'), ...u32(0)]), ...box('moov', mvhd)]
  const len = opts.len ?? 4_096
  const mdat = [...u32(len - head.length), ...ascii('mdat')]
  return pad([...head, ...mdat], len)
}

const ebml = (id: number[], payload: number[]) => {
  if (payload.length > 126) throw new Error('fixture: payload too large for a 1-byte size')
  return [...id, 0x80 | payload.length, ...payload]
}
const float64 = (n: number) => {
  const b = new DataView(new ArrayBuffer(8))
  b.setFloat64(0, n)
  return [...new Uint8Array(b.buffer)]
}

/**
 * WebM as MediaRecorder writes it — an unknown-size Segment — with an Info
 * element declaring `durationMs` (TimecodeScale 1 ms), or no Duration at all
 * (`null`, what Chrome actually produces).
 */
export function webm(durationMs: number | null, len = 4_096): Uint8Array<ArrayBuffer> {
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x86, 0x81, 0x01])
  const info = ebml(
    [0x15, 0x49, 0xa9, 0x66],
    [...ebml([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...(durationMs == null ? [] : ebml([0x44, 0x89], float64(durationMs)))],
  )
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...info]
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
  return pad([...header, ...segment, ...cluster], len)
}

const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
const oggPage = (granule: number, packet: number[]) => [
  ...ascii('OggS'),
  0,
  0,
  ...le32(granule % 2 ** 32),
  ...le32(Math.floor(granule / 2 ** 32)),
  ...le32(1),
  ...le32(0),
  ...le32(0),
  1,
  packet.length,
  ...packet,
]

/**
 * Ogg Opus whose last page's granule position declares `durationMs` (48 kHz,
 * pre-skip 312). `lastBody` is that final page's audio data (≤ 255 bytes).
 */
export function oggOpus(durationMs: number, len = 4_096, lastBody: number[] = [0]): Uint8Array<ArrayBuffer> {
  const preSkip = 312
  const opusHead = [...ascii('OpusHead'), 1, 1, ...le16(preSkip), ...le32(48_000), 0, 0, 0]
  const first = oggPage(0, opusHead)
  const last = oggPage(Math.round((durationMs / 1000) * 48_000) + preSkip, lastBody)
  const b = pad(first, len)
  b.set(last, len - last.length)
  return b
}

/** Bytes that LOOK like an Ogg page start inside audio data, claiming a 10-hour granule. */
export const spuriousOggS = (): number[] => [
  ...ascii('OggS'),
  0,
  0,
  ...le32((10 * 3600 * 48_000) % 2 ** 32),
  ...le32(Math.floor((10 * 3600 * 48_000) / 2 ** 32)),
  ...new Array(16).fill(7),
]
