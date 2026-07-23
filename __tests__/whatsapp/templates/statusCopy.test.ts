import { describe, it, expect } from 'vitest'
import {
  mapTemplateStatus,
  mapRejectionReason,
  failureTextForRejectionKey,
  statusLabel,
} from '@/lib/whatsapp/templates/statusCopy'

const RAW_META_REASONS = ['INVALID_FORMAT', 'INVALID_PARAMETER', 'TAG_CONTENT_MISMATCH', 'ABUSIVE_CONTENT', 'SCAM', 'PROMOTIONAL', 'NONE']

describe('mapTemplateStatus', () => {
  it('maps the known Meta statuses', () => {
    expect(mapTemplateStatus('APPROVED')).toBe('approved')
    expect(mapTemplateStatus('REJECTED')).toBe('rejected')
    expect(mapTemplateStatus('PAUSED')).toBe('paused')
    expect(mapTemplateStatus('DISABLED')).toBe('disabled')
    expect(mapTemplateStatus('PENDING_DELETION')).toBe('disabled')
    expect(mapTemplateStatus('DELETED')).toBe('disabled')
    expect(mapTemplateStatus('PENDING')).toBe('pending')
  })
  it('is case-insensitive', () => {
    expect(mapTemplateStatus('approved')).toBe('approved')
  })
  it('degrades unknown / quality states to pending (never falsely usable)', () => {
    expect(mapTemplateStatus('IN_APPEAL')).toBe('pending')
    expect(mapTemplateStatus('FLAGGED')).toBe('pending')
    expect(mapTemplateStatus('SOMETHING_NEW')).toBe('pending')
    expect(mapTemplateStatus(null)).toBe('pending')
    expect(mapTemplateStatus(undefined)).toBe('pending')
  })
})

describe('mapRejectionReason', () => {
  it('buckets known reasons', () => {
    expect(mapRejectionReason('INVALID_FORMAT').key).toBe('invalid_format')
    expect(mapRejectionReason('INVALID_PARAMETER').key).toBe('invalid_format')
    expect(mapRejectionReason('TAG_CONTENT_MISMATCH').key).toBe('content_mismatch')
    expect(mapRejectionReason('ABUSIVE_CONTENT').key).toBe('policy')
    expect(mapRejectionReason('SCAM').key).toBe('policy')
    expect(mapRejectionReason('PROMOTIONAL').key).toBe('policy')
  })
  it('unknown / missing reason → generic', () => {
    expect(mapRejectionReason('NONE').key).toBe('generic')
    expect(mapRejectionReason('WHATEVER').key).toBe('generic')
    expect(mapRejectionReason(null).key).toBe('generic')
    expect(mapRejectionReason(undefined).key).toBe('generic')
  })
  it('returns non-empty Hebrew text and never leaks a raw Meta reason', () => {
    for (const reason of [...RAW_META_REASONS, 'UNKNOWN', null]) {
      const { text } = mapRejectionReason(reason)
      expect(text.length).toBeGreaterThan(0)
      expect(text).toMatch(/[֐-׿]/) // contains Hebrew
      for (const raw of RAW_META_REASONS) expect(text).not.toContain(raw)
      expect(text).not.toMatch(/[A-Z]{4,}/) // no enum-like uppercase run
    }
  })
})

describe('failureTextForRejectionKey', () => {
  it('resolves a stored key to its copy', () => {
    expect(failureTextForRejectionKey('policy')).toBe(mapRejectionReason('SCAM').text)
    expect(failureTextForRejectionKey('invalid_format')).toBe(mapRejectionReason('INVALID_FORMAT').text)
  })
  it('null / empty → null (nothing to show)', () => {
    expect(failureTextForRejectionKey(null)).toBeNull()
    expect(failureTextForRejectionKey(undefined)).toBeNull()
    expect(failureTextForRejectionKey('')).toBeNull()
  })
  it('unrecognized stored key → generic, never throws', () => {
    expect(failureTextForRejectionKey('future_key')).toBe(mapRejectionReason('NONE').text)
  })
})

describe('statusLabel', () => {
  it('returns Hebrew labels, no Meta terms', () => {
    expect(statusLabel('approved')).toBe('מוכנה לשליחה')
    expect(statusLabel('pending')).toBe('בבדיקה')
    expect(statusLabel('rejected')).toBe('נדחתה')
    expect(statusLabel('approved')).not.toMatch(/APPROVED/i)
  })
})
