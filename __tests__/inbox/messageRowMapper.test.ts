import { describe, it, expect } from 'vitest'
import { mapLeadWhatsappMessageRow } from '@/db/inboxMessages'
import { mapWhatsappError } from '@/lib/inbox/whatsappErrorCopy'

const base = {
  id: '7',
  direction: 'outbound',
  type: 'text',
  text: 'שלום',
  status: 'sent',
  errorReason: null,
  channelTimestamp: new Date('2026-07-22T12:39:03.000Z'),
  createdAt: new Date('2026-07-22T12:39:04.000Z'),
}

describe('mapLeadWhatsappMessageRow', () => {
  it('carries the status through', () => {
    expect(mapLeadWhatsappMessageRow({ ...base, status: 'delivered' }).status).toBe('delivered')
  })

  it('prefers channelTimestamp over createdAt', () => {
    expect(mapLeadWhatsappMessageRow(base).timestamp).toBe('2026-07-22T12:39:03.000Z')
  })

  it('falls back to createdAt when channelTimestamp is null', () => {
    expect(mapLeadWhatsappMessageRow({ ...base, channelTimestamp: null }).timestamp).toBe(
      '2026-07-22T12:39:04.000Z',
    )
  })

  it('resolves failureText only for failed rows', () => {
    const failed = mapLeadWhatsappMessageRow({ ...base, status: 'failed', errorReason: 'window_expired' })
    expect(failed.failureText).toBe(mapWhatsappError(131047).text)
  })

  it('leaves failureText null for non-failed rows even if errorReason is set', () => {
    const sent = mapLeadWhatsappMessageRow({ ...base, status: 'sent', errorReason: 'window_expired' })
    expect(sent.failureText).toBeNull()
  })

  it('a failed row with no stored category still gets generic copy, never null', () => {
    const failed = mapLeadWhatsappMessageRow({ ...base, status: 'failed', errorReason: null })
    expect(failed.failureText).toBe(mapWhatsappError(999999).text)
  })

  it('exposes failureCategory (the persisted key) only for failed rows', () => {
    expect(mapLeadWhatsappMessageRow({ ...base, status: 'failed', errorReason: 'recipient' }).failureCategory).toBe('recipient')
    // non-failed → null even if a stale errorReason is present
    expect(mapLeadWhatsappMessageRow({ ...base, status: 'sent', errorReason: 'recipient' }).failureCategory).toBeNull()
    // failed + missing/unknown key → generic, never null/raw
    expect(mapLeadWhatsappMessageRow({ ...base, status: 'failed', errorReason: null }).failureCategory).toBe('generic')
    expect(mapLeadWhatsappMessageRow({ ...base, status: 'failed', errorReason: 'future_key' }).failureCategory).toBe('generic')
  })

  it('never exposes a raw Meta code', () => {
    const failed = mapLeadWhatsappMessageRow({ ...base, status: 'failed', errorReason: 'account' })
    expect(failed.failureText).not.toMatch(/\d{3,}/)
  })

  it('coerces a bigint-as-string id to a number', () => {
    expect(mapLeadWhatsappMessageRow(base).id).toBe(7)
  })

  it('empty text maps to an empty string, not undefined', () => {
    expect(mapLeadWhatsappMessageRow({ ...base, text: null }).text).toBe('')
  })
})
