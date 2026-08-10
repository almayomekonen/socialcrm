import { describe, it, expect, afterEach } from 'vitest'
import {
  isFacebookCommentsEnabledForAgency,
  hasCommentTextCapability,
  COMMENT_TEXT_PERMISSION,
} from '@/lib/facebook/comments/capability'

afterEach(() => {
  delete process.env.FACEBOOK_COMMENTS_ENABLED
  delete process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST
})

describe('isFacebookCommentsEnabledForAgency — absence blocks', () => {
  it('is OFF when nothing is configured', () => {
    expect(isFacebookCommentsEnabledForAgency(103)).toBe(false)
  })

  it('is OFF when the kill switch is off even with an allowlist', () => {
    process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = '103'
    expect(isFacebookCommentsEnabledForAgency(103)).toBe(false)
  })

  it('is OFF when enabled but the agency is not allowlisted', () => {
    process.env.FACEBOOK_COMMENTS_ENABLED = '1'
    process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = '999'
    expect(isFacebookCommentsEnabledForAgency(103)).toBe(false)
  })

  it('is ON for an allowlisted agency', () => {
    process.env.FACEBOOK_COMMENTS_ENABLED = '1'
    process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = '42, 103 ,7'
    expect(isFacebookCommentsEnabledForAgency(103)).toBe(true)
  })

  it('supports the literal "all"', () => {
    process.env.FACEBOOK_COMMENTS_ENABLED = '1'
    process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = 'all'
    expect(isFacebookCommentsEnabledForAgency(1)).toBe(true)
  })

  it('is OFF for a non-numeric agency id', () => {
    process.env.FACEBOOK_COMMENTS_ENABLED = '1'
    process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = 'all'
    expect(isFacebookCommentsEnabledForAgency(null)).toBe(false)
    expect(isFacebookCommentsEnabledForAgency(undefined)).toBe(false)
  })
})

describe('hasCommentTextCapability', () => {
  it('names the permission Meta actually requires', () => {
    expect(COMMENT_TEXT_PERMISSION).toBe('pages_read_user_content')
  })

  it('is false for the scopes production holds today', () => {
    expect(hasCommentTextCapability(['pages_show_list', 'pages_manage_metadata', 'leads_retrieval'])).toBe(false)
  })

  it('is false when only pages_read_engagement is present', () => {
    expect(hasCommentTextCapability(['pages_read_engagement'])).toBe(false)
  })

  it('is true once pages_read_user_content is granted', () => {
    expect(hasCommentTextCapability(['pages_manage_metadata', 'pages_read_user_content'])).toBe(true)
  })

  it('is total over empty input', () => {
    expect(hasCommentTextCapability([])).toBe(false)
  })
})
