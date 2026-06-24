import { describe, it, expect } from 'vitest'
import { serializeInboxFilters } from '@/modules/inbox/client/serializeInboxFilters'
import { DEFAULT_INBOX_FILTERS } from '@/modules/inbox/types'

describe('serializeInboxFilters', () => {
  it('omits all defaults (empty query string)', () => {
    expect(serializeInboxFilters(DEFAULT_INBOX_FILTERS).toString()).toBe('')
  })
  it('serializes non-default values the endpoint can parse', () => {
    const p = serializeInboxFilters({
      ...DEFAULT_INBOX_FILTERS,
      q: 'דוד',
      status: 'open',
      sort: 'unread',
      intel: 'hot',
      unread: true,
      needsReply: true,
    })
    expect(p.get('q')).toBe('דוד')
    expect(p.get('status')).toBe('open')
    expect(p.get('sort')).toBe('unread')
    expect(p.get('intel')).toBe('hot')
    expect(p.get('unread')).toBe('1')
    expect(p.get('needsReply')).toBe('1')
  })
  it('omits latest sort and all intel (defaults)', () => {
    const p = serializeInboxFilters({ ...DEFAULT_INBOX_FILTERS, sort: 'latest', intel: 'all' })
    expect(p.has('sort')).toBe(false)
    expect(p.has('intel')).toBe(false)
  })
})
