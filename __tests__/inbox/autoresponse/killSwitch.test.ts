import { describe, it, expect, afterEach } from 'vitest'
import { isQualifierEnabled } from '@/lib/inbox/autoresponse/killSwitch'

afterEach(() => {
  delete process.env.INBOX_QUALIFIER_KILL
})

describe('isQualifierEnabled (global kill switch)', () => {
  it('enabled by default (env unset)', () => {
    delete process.env.INBOX_QUALIFIER_KILL
    expect(isQualifierEnabled()).toBe(true)
  })
  it('killed with =1', () => {
    process.env.INBOX_QUALIFIER_KILL = '1'
    expect(isQualifierEnabled()).toBe(false)
  })
  it('killed with =true', () => {
    process.env.INBOX_QUALIFIER_KILL = 'true'
    expect(isQualifierEnabled()).toBe(false)
  })
  it('stays enabled for any other value', () => {
    process.env.INBOX_QUALIFIER_KILL = '0'
    expect(isQualifierEnabled()).toBe(true)
  })
})
