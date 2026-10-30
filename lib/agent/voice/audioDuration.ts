import type { VoiceContainer } from './limits'

/**
 * The duration an upload's container METADATA declares — a guard, never a bound.
 *
 * Metadata is written by the sender. It can be absent (Chrome's MediaRecorder
 * WebM carries no Duration; fragmented MP4 from Safari usually declares 0) or
 * forged (a header claiming 60 s in front of 30 minutes of audio), and the
 * provider bills what it decodes. Bytes do not bound duration either: Opus with
 * DTX spends almost nothing on silence. So the route refuses an upload whose
 * metadata declares more than the cap, before the provider is called, and
 * everything else proves nothing — the cost estimate stays `partial`.
 *
 * Returns milliseconds, or null when no usable duration is declared. Pure,
 * bounds-checked, never throws.
 */
export function probeAudioDurationMs(bytes: Uint8Array, container: VoiceContainer): number | null {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ms = container === 'mp4' ? mp4(v) : container === 'webm' ? webm(v) : ogg(v, bytes)
    return ms != null && Number.isFinite(ms) && ms > 0 ? ms : null
  } catch {
    return null
  }
}

const MAX_ELEMENTS = 10_000

// ── MP4: moov → mvhd (timescale, duration). ──────────────────────────────────
const fourcc = (v: DataView, o: number) =>
  String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))

function mp4(v: DataView): number | null {
  return boxes(v, 0, v.byteLength, false)
}

function boxes(v: DataView, start: number, end: number, inMoov: boolean): number | null {
  let off = start
  for (let n = 0; n < MAX_ELEMENTS && off + 8 <= end; n++) {
    let size = v.getUint32(off)
    let header = 8
    if (size === 1) {
      if (off + 16 > end) return null
      size = v.getUint32(off + 8) * 2 ** 32 + v.getUint32(off + 12)
      header = 16
    } else if (size === 0) {
      size = end - off // extends to the end
    }
    if (size < header || off + size > end) return null
    const type = fourcc(v, off + 4)
    if (!inMoov && type === 'moov') return boxes(v, off + header, off + size, true)
    if (inMoov && type === 'mvhd') return mvhd(v, off + header, off + size)
    off += size
  }
  return null
}

function mvhd(v: DataView, p: number, end: number): number | null {
  const version = v.getUint8(p)
  let timescale: number
  let duration: number
  if (version === 1) {
    if (p + 32 > end) return null
    timescale = v.getUint32(p + 20)
    const hi = v.getUint32(p + 24)
    const lo = v.getUint32(p + 28)
    if (hi === 0xffffffff && lo === 0xffffffff) return null
    duration = hi * 2 ** 32 + lo
  } else {
    if (p + 20 > end) return null
    timescale = v.getUint32(p + 12)
    duration = v.getUint32(p + 16)
    if (duration === 0xffffffff) return null // "unknown"
  }
  return timescale > 0 && duration > 0 ? (duration / timescale) * 1000 : null
}

// ── WebM (EBML): Segment → Info → TimecodeScale + Duration. ──────────────────
const ID_EBML = 0x1a45dfa3
const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_CLUSTER = 0x1f43b675
const ID_TIMECODE_SCALE = 0x2ad7b1
const ID_DURATION = 0x4489

/** An EBML variable-length integer: its byte length, and its value (marker kept for ids, stripped for sizes). */
function vint(v: DataView, off: number, keepMarker: boolean): { len: number; value: number; unknown: boolean } | null {
  if (off >= v.byteLength) return null
  const first = v.getUint8(off)
  let len = 1
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++
  if (len > 8 || off + len > v.byteLength) return null
  let value = keepMarker ? first : first & (0xff >> len)
  let allOnes = value === 0xff >> len
  for (let i = 1; i < len; i++) {
    const b = v.getUint8(off + i)
    value = value * 256 + b
    if (b !== 0xff) allOnes = false
  }
  return { len, value, unknown: !keepMarker && allOnes }
}

function element(v: DataView, off: number) {
  const id = vint(v, off, true)
  if (!id) return null
  const size = vint(v, off + id.len, false)
  if (!size) return null
  const dataStart = off + id.len + size.len
  return { id: id.value, dataStart, size: size.unknown ? null : size.value }
}

function webm(v: DataView): number | null {
  let off = 0
  for (let n = 0; n < MAX_ELEMENTS && off < v.byteLength; n++) {
    const el = element(v, off)
    if (!el) return null
    if (el.id === ID_SEGMENT) return segmentInfo(v, el.dataStart, el.size == null ? v.byteLength : el.dataStart + el.size)
    if (el.id !== ID_EBML || el.size == null) return null
    off = el.dataStart + el.size
  }
  return null
}

function segmentInfo(v: DataView, start: number, end: number): number | null {
  let off = start
  for (let n = 0; n < MAX_ELEMENTS && off < Math.min(end, v.byteLength); n++) {
    const el = element(v, off)
    if (!el || el.id === ID_CLUSTER || el.size == null) return null // media begins / unsized: no Info first
    if (el.id === ID_INFO) return info(v, el.dataStart, Math.min(el.dataStart + el.size, v.byteLength))
    off = el.dataStart + el.size
  }
  return null
}

function info(v: DataView, start: number, end: number): number | null {
  let scaleNs = 1_000_000 // the Matroska default
  let duration: number | null = null
  let off = start
  for (let n = 0; n < MAX_ELEMENTS && off < end; n++) {
    const el = element(v, off)
    if (!el || el.size == null || el.dataStart + el.size > end) return null
    if (el.id === ID_TIMECODE_SCALE && el.size >= 1 && el.size <= 8) {
      let s = 0
      for (let i = 0; i < el.size; i++) s = s * 256 + v.getUint8(el.dataStart + i)
      if (s > 0) scaleNs = s
    } else if (el.id === ID_DURATION) {
      if (el.size === 4) duration = v.getFloat32(el.dataStart)
      else if (el.size === 8) duration = v.getFloat64(el.dataStart)
      else return null
    }
    off = el.dataStart + el.size
  }
  return duration == null ? null : (duration * scaleNs) / 1e6
}

// ── Ogg (Opus): the last page's granule position at 48 kHz, minus pre-skip. ───
const OGG_TAIL_BYTES = 65_536

/**
 * "OggS" at `o` starts the FINAL page only if it parses as a page header —
 * stream structure version 0, no undefined header-type bits — and the page it
 * describes ends exactly at the end of the file. A stray "OggS" inside audio
 * data fails these checks and the scan moves on.
 */
function isFinalPage(bytes: Uint8Array, o: number): boolean {
  if (bytes[o + 4] !== 0 || (bytes[o + 5] & 0xf8) !== 0) return false
  const segments = bytes[o + 26]
  const bodyStart = o + 27 + segments
  if (bodyStart > bytes.length) return false
  let body = 0
  for (let i = 0; i < segments; i++) body += bytes[o + 27 + i]
  return bodyStart + body === bytes.length
}

function ogg(v: DataView, bytes: Uint8Array): number | null {
  if (v.byteLength < 28) return null
  const segments = v.getUint8(26)
  const packet = 27 + segments
  if (packet + 12 > v.byteLength) return null
  const magic = String.fromCharCode(...bytes.subarray(packet, packet + 8))
  if (magic !== 'OpusHead') return null // Vorbis etc.: the sample rate would have to be parsed too
  const preSkip = v.getUint16(packet + 10, true)
  for (let o = v.byteLength - 27; o >= Math.max(0, v.byteLength - OGG_TAIL_BYTES); o--) {
    if (bytes[o] === 0x4f && bytes[o + 1] === 0x67 && bytes[o + 2] === 0x67 && bytes[o + 3] === 0x53 && isFinalPage(bytes, o)) {
      // 64-bit little-endian granule position, read as two halves (no BigInt literal in this target).
      const lo = v.getUint32(o + 6, true)
      const hi = v.getInt32(o + 10, true)
      if (hi < 0) return null // -1 = "no packet ends on this page"
      const granule = hi * 2 ** 32 + lo
      if (granule <= 0) return null
      return ((granule - preSkip) / 48_000) * 1000
    }
  }
  return null
}
