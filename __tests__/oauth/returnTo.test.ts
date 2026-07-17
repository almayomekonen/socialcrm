/**
 * lib/oauth/returnTo — pure validation of the OAuth return path. No DB, no mocks.
 * Pins the open-redirect guard: only same-origin relative paths pass.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeReturnTo, DEFAULT_RETURN } from '@/lib/oauth/returnTo'

describe('sanitizeReturnTo', () => {
  it('accepts a plain relative path', () => {
    expect(sanitizeReturnTo('/settings/integrations')).toBe('/settings/integrations')
  })
  it('accepts a relative path that already has a query string', () => {
    expect(sanitizeReturnTo('/settings/x?y=1')).toBe('/settings/x?y=1')
  })
  it('rejects protocol-relative URLs', () => {
    expect(sanitizeReturnTo('//evil.com')).toBeNull()
  })
  it('rejects absolute URLs', () => {
    expect(sanitizeReturnTo('https://evil.com')).toBeNull()
  })
  it('rejects the backslash trick', () => {
    expect(sanitizeReturnTo('/\\evil.com')).toBeNull()
  })
  it('rejects paths without a leading slash', () => {
    expect(sanitizeReturnTo('settings')).toBeNull()
  })
  it('rejects control characters (cookie-safety)', () => {
    expect(sanitizeReturnTo('/a\nb')).toBeNull()
  })
  it('rejects empty / nullish input', () => {
    expect(sanitizeReturnTo('')).toBeNull()
    expect(sanitizeReturnTo(null)).toBeNull()
    expect(sanitizeReturnTo(undefined)).toBeNull()
  })
  it('exposes the /dashboard default', () => {
    expect(DEFAULT_RETURN).toBe('/dashboard')
  })
})
