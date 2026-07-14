import { describe, it, expect } from 'vitest'
import { renderFixedReply, resolveFirstName } from '@/lib/inbox/autoresponse/renderFixedReply'
import { parseReplyMode, clampDelaySeconds } from '@/lib/inbox/autoresponse/replyMode'

describe('resolveFirstName', () => {
  it('prefers lead firstName', () => {
    expect(resolveFirstName({ firstName: 'דוד', customerName: 'Other Name' })).toBe('דוד')
  })
  it('falls back to first token of customerName', () => {
    expect(resolveFirstName({ firstName: null, customerName: 'Maya Cohen' })).toBe('Maya')
  })
  it('returns empty when nothing available', () => {
    expect(resolveFirstName({ firstName: '  ', customerName: null })).toBe('')
  })
})

describe('renderFixedReply', () => {
  it('replaces {{firstName}}', () => {
    expect(renderFixedReply('Hi {{firstName}}!', { firstName: 'Dana' })).toBe('Hi Dana!')
  })
  it('allows spaces inside braces', () => {
    expect(renderFixedReply('Hi {{ firstName }}!', { firstName: 'Dana' })).toBe('Hi Dana!')
  })
  it('leaves unknown tokens unchanged', () => {
    expect(renderFixedReply('Hi {{lastName}}', { firstName: 'Dana' })).toBe('Hi {{lastName}}')
  })
  it('replaces all occurrences', () => {
    expect(renderFixedReply('{{firstName}} / {{firstName}}', { firstName: 'A' })).toBe('A / A')
  })
})

describe('reply mode helpers', () => {
  it('parseReplyMode defaults unknown to ai', () => {
    expect(parseReplyMode('fixed')).toBe('fixed')
    expect(parseReplyMode('ai')).toBe('ai')
    expect(parseReplyMode('nope')).toBe('ai')
    expect(parseReplyMode(null)).toBe('ai')
  })
  it('clampDelaySeconds bounds to 0..3600', () => {
    expect(clampDelaySeconds(-1)).toBe(0)
    expect(clampDelaySeconds(12.9)).toBe(12)
    expect(clampDelaySeconds(99999)).toBe(3600)
    expect(clampDelaySeconds(Number.NaN)).toBe(0)
  })
})
