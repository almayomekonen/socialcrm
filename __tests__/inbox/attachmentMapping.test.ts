/**
 * Row payload → the client-visible attachment shape.
 *
 * The mapper is the ONLY place a stored WhatsApp payload becomes something a
 * browser sees, so it is also the only place the media id, Meta URL and sha256
 * can leak. These tests pin that they do not.
 */
import { describe, expect, it } from 'vitest'
import {
  toSafeAttachment,
  sanitizeAttachmentFilename,
  sanitizeAttachmentMime,
  mapLeadWhatsappMessageRow,
} from '@/db/inboxMessages'
import { fileKindLabel, UNSUPPORTED_MESSAGE_NOTICE } from '@/lib/inbox/attachmentDisplay'

const docPayload = {
  id: 'MEDIA_ID_123456',
  url: 'https://lookaside.fbsbx.com/SECRET',
  sha256: 'DEADBEEF',
  filename: 'הצעת מחיר.pdf',
  mime_type: 'application/pdf',
}

describe('toSafeAttachment', () => {
  it('maps a document to filename + mimeType', () => {
    expect(toSafeAttachment('document', docPayload)).toEqual({
      filename: 'הצעת מחיר.pdf',
      mimeType: 'application/pdf',
    })
  })

  it('exposes ONLY filename and mimeType', () => {
    expect(Object.keys(toSafeAttachment('document', docPayload)!).sort()).toEqual(['filename', 'mimeType'])
  })

  it('never returns the media id, Meta URL or sha256', () => {
    const serialized = JSON.stringify(toSafeAttachment('document', docPayload))
    expect(serialized).not.toContain('MEDIA_ID_123456')
    expect(serialized).not.toContain('lookaside.fbsbx.com')
    expect(serialized).not.toContain('DEADBEEF')
  })

  it('returns null without a media id, because the file could never be fetched', () => {
    expect(toSafeAttachment('document', { filename: 'x.pdf', mime_type: 'application/pdf' })).toBeNull()
  })

  it('returns null for text and unknown types', () => {
    expect(toSafeAttachment('text', { id: 'x' })).toBeNull()
    expect(toSafeAttachment('unknown', { id: 'x' })).toBeNull()
  })

  it('accepts image, audio, video and sticker', () => {
    for (const t of ['image', 'audio', 'video', 'sticker']) {
      expect(toSafeAttachment(t, { id: 'x', mime_type: 'image/jpeg' })).not.toBeNull()
    }
  })

  it('survives a malformed payload', () => {
    expect(toSafeAttachment('document', null)).toBeNull()
    expect(toSafeAttachment('document', 'nope')).toBeNull()
    expect(toSafeAttachment('document', [])).toBeNull()
    expect(toSafeAttachment('document', { id: 'x' })).toEqual({ filename: null, mimeType: null })
  })
})

describe('sanitisation', () => {
  it('strips CR/LF and control characters from a customer-supplied filename', () => {
    const out = sanitizeAttachmentFilename('evil.pdf\r\nSet-Cookie: a=b')
    expect(out).not.toContain('\r')
    expect(out).not.toContain('\n')
  })

  it('caps filename length and rejects non-strings', () => {
    expect(sanitizeAttachmentFilename('a'.repeat(500))!.length).toBe(120)
    expect(sanitizeAttachmentFilename(null)).toBeNull()
    expect(sanitizeAttachmentFilename('   ')).toBeNull()
  })

  it('accepts a well-formed mime and drops parameters', () => {
    expect(sanitizeAttachmentMime('application/pdf; charset=utf-8')).toBe('application/pdf')
    expect(sanitizeAttachmentMime('IMAGE/JPEG')).toBe('image/jpeg')
  })

  it('rejects a malformed mime rather than passing it through', () => {
    expect(sanitizeAttachmentMime('not-a-mime')).toBeNull()
    expect(sanitizeAttachmentMime('text/html\r\nX: y')).toBeNull()
  })
})

describe('row mapping', () => {
  const base = { id: 7, direction: 'inbound', status: 'received', errorReason: null, createdAt: new Date(0) }

  it('attaches media metadata for a document row', () => {
    const m = mapLeadWhatsappMessageRow({ ...base, type: 'document', text: '', payload: docPayload })
    expect(m.attachment).toEqual({ filename: 'הצעת מחיר.pdf', mimeType: 'application/pdf' })
  })

  it('leaves a normal text message unchanged', () => {
    const m = mapLeadWhatsappMessageRow({ ...base, type: 'text', text: 'שלום', payload: {} })
    expect(m.text).toBe('שלום')
    expect(m.attachment).toBeNull()
  })

  it('gives an unsupported type no attachment, so the UI can show the fallback', () => {
    const m = mapLeadWhatsappMessageRow({ ...base, type: 'unknown', text: '', payload: { raw_type: 'unknown' } })
    expect(m.attachment).toBeNull()
    expect(m.text).toBe('')
  })
})

describe('display labels', () => {
  it('labels common business file types', () => {
    expect(fileKindLabel('application/pdf')).toBe('PDF')
    expect(fileKindLabel('image/jpeg')).toBe('תמונה')
    expect(fileKindLabel('audio/ogg')).toBe('הקלטה')
    expect(fileKindLabel('video/mp4')).toBe('וידאו')
    expect(fileKindLabel(null)).toBeNull()
  })

  it('has an honest Hebrew notice for unsupported messages', () => {
    expect(UNSUPPORTED_MESSAGE_NOTICE).toMatch(/[֐-׿]/)
    expect(UNSUPPORTED_MESSAGE_NOTICE).not.toBe('—')
  })
})
