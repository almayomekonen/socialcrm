import { describe, expect, it } from 'vitest'
import { hasCtwaReferral } from '@/lib/whatsapp/classifyInbound'

describe('hasCtwaReferral — fail-safe', () => {
  it('rejects missing / malformed payloads', () => {
    expect(hasCtwaReferral(null)).toBe(false)
    expect(hasCtwaReferral(undefined)).toBe(false)
    expect(hasCtwaReferral('ad')).toBe(false)
    expect(hasCtwaReferral({})).toBe(false)
    expect(hasCtwaReferral({ referral: null })).toBe(false)
    expect(hasCtwaReferral({ referral: 'ad' })).toBe(false)
    expect(hasCtwaReferral({ referral: {} })).toBe(false)
    expect(hasCtwaReferral({ text: { body: 'click my ad' } })).toBe(false)
  })

  it('accepts a verified CTWA referral', () => {
    expect(hasCtwaReferral({ referral: { source_type: 'ad', source_id: '123' } })).toBe(true)
    expect(hasCtwaReferral({ referral: { ctwa_clid: 'clid-1' } })).toBe(true)
  })

  it('rejects an empty ctwa_clid without source_type=ad', () => {
    expect(hasCtwaReferral({ referral: { ctwa_clid: '   ' } })).toBe(false)
  })
})
