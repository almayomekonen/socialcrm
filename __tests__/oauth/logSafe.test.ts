import { describe, it, expect } from 'vitest'
import { errorClass } from '@/lib/oauth/server/logSafe'

describe('errorClass — OAuth error logs never carry the message', () => {
  it('keeps name and a string code only', () => {
    const e = Object.assign(new Error('insert into oauth_refresh_tokens ... token_hash abc123 - duplicate key'), {
      code: '23505',
    })
    expect(errorClass(e)).toEqual({ error: 'Error', code: '23505' })
    expect(JSON.stringify(errorClass(e))).not.toContain('abc123')
  })
  it('handles non-errors and numeric codes', () => {
    expect(errorClass('boom')).toEqual({ error: 'unknown' })
    expect(errorClass(Object.assign(new TypeError('x'), { code: 5 }))).toEqual({ error: 'TypeError' })
  })
})
