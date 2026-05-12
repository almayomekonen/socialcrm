import { describe, it, expect } from 'vitest'
import {
  inferCopilotMediaType,
  isCopilotImageMime,
  isCopilotTextMime,
  COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP,
  COPILOT_ATTACHMENT_TOTAL_CHAR_CAP,
} from '@/lib/copilot/attachments'

// ─── inferCopilotMediaType ───────────────────────────────────────────────────
// Browsers sometimes hand us a File with empty `.type` (rare on macOS Safari,
// occasional on Linux for unusual extensions). The composer's chip flow and
// the server's mime gates both depend on this fallback being deterministic.

describe('inferCopilotMediaType — browser-provided type wins when present', () => {
  it.each([
    ['photo.png', 'image/png', 'image/png'],
    ['scan.pdf', 'application/pdf', 'application/pdf'],
    ['data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    // Non-empty type — should never re-derive from extension.
    ['mismatch.pdf', 'image/png', 'image/png'],
  ])('returns provided type for %s + %s', (name, type, expected) => {
    expect(inferCopilotMediaType(name, type)).toBe(expected)
  })
})

describe('inferCopilotMediaType — extension fallback when type is empty/null/whitespace', () => {
  it.each([
    ['cv.pdf', '', 'application/pdf'],
    ['cv.PDF', '', 'application/pdf'],
    ['sheet.xls', '', 'application/vnd.ms-excel'],
    ['sheet.xlsx', '', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['photo.png', '', 'image/png'],
    ['photo.jpg', '', 'image/jpeg'],
    ['photo.jpeg', '', 'image/jpeg'],
    ['photo.JPEG', '', 'image/jpeg'],
    ['photo.webp', '', 'image/webp'],
  ])('falls back to extension for %s when type is empty', (name, type, expected) => {
    expect(inferCopilotMediaType(name, type)).toBe(expected)
  })

  it('handles null type', () => {
    expect(inferCopilotMediaType('cv.pdf', null)).toBe('application/pdf')
  })

  it('handles undefined type', () => {
    expect(inferCopilotMediaType('cv.pdf', undefined)).toBe('application/pdf')
  })

  it('returns empty string when no signal at all', () => {
    expect(inferCopilotMediaType('mystery.bin', '')).toBe('')
    expect(inferCopilotMediaType('noext', null)).toBe('')
  })
})

// ─── isCopilotImageMime / isCopilotTextMime ─────────────────────────────────

describe('isCopilotImageMime', () => {
  it.each([['image/png'], ['image/jpeg'], ['image/jpg'], ['image/webp']])('accepts %s', (m) => {
    expect(isCopilotImageMime(m)).toBe(true)
  })

  it.each([['IMAGE/PNG'], ['Image/Jpeg']])('is case-insensitive (%s)', (m) => {
    expect(isCopilotImageMime(m)).toBe(true)
  })

  it.each([['application/pdf'], ['image/gif'], ['image/svg+xml'], [''], [null], [undefined]])(
    'rejects %s',
    (m) => {
      expect(isCopilotImageMime(m as string | null | undefined)).toBe(false)
    },
  )
})

describe('isCopilotTextMime', () => {
  it.each([
    ['application/pdf'],
    ['application/vnd.ms-excel'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('accepts %s', (m) => {
    expect(isCopilotTextMime(m)).toBe(true)
  })

  it.each([['image/png'], ['text/plain'], ['application/json'], [''], [null], [undefined]])(
    'rejects %s',
    (m) => {
      expect(isCopilotTextMime(m as string | null | undefined)).toBe(false)
    },
  )
})

// ─── Cap constants — guard against accidental retuning ──────────────────────
// These caps are also enforced server-side; the test catches any inadvertent
// drift between the constant and the values it shipped with.

describe('attachment caps', () => {
  it('per-file cap is 30k chars', () => {
    expect(COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP).toBe(30_000)
  })

  it('total cap is 60k chars (per-question budget)', () => {
    expect(COPILOT_ATTACHMENT_TOTAL_CHAR_CAP).toBe(60_000)
  })

  it('per-file cap does not exceed the total budget', () => {
    expect(COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP).toBeLessThanOrEqual(COPILOT_ATTACHMENT_TOTAL_CHAR_CAP)
  })
})
