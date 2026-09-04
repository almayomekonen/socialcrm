import { describe, expect, it } from 'vitest'
import { describeDbError } from '@/lib/system/dbErrorInfo'

/**
 * `webhook_failures.error_detail` is a diagnostics column, so what goes into it
 * matters twice: it must identify the failure, and it must not retain a single
 * customer value. Postgres puts the offending key IN `err.detail`
 * ("Key (email)=(dana@example.com) already exists"), which is exactly why
 * `detail` is never read.
 */
describe('describeDbError', () => {
  it('keeps SQLSTATE and the constraint name — enough to identify the failure', () => {
    const info = describeDbError({
      code: '23505',
      constraint: 'clients_agency_phone_unique',
      table: 'clients',
      detail: 'Key (phone)=(972521234567) already exists.',
      message: 'duplicate key value violates unique constraint',
    })

    expect(info.code).toBe('23505')
    expect(info.constraint).toBe('clients_agency_phone_unique')
    expect(info.summary).toContain('sqlstate=23505')
    expect(info.summary).toContain('constraint=clients_agency_phone_unique')
  })

  it('never lets the offending key value through', () => {
    const info = describeDbError({
      code: '23505',
      constraint: 'clients_agency_email_unique',
      detail: 'Key (email)=(dana@example.com) already exists.',
    })

    expect(info.summary).not.toContain('dana@example.com')
    expect(JSON.stringify(info)).not.toContain('dana@example.com')
  })

  it('falls back to the message only when nothing structured is present', () => {
    // A connection failure carries no code/constraint — and no PII either.
    const info = describeDbError({ message: 'Connection terminated unexpectedly' })
    expect(info.code).toBeNull()
    expect(info.constraint).toBeNull()
    expect(info.summary).toBe('error=Connection terminated unexpectedly')
  })

  it('degrades safely on a non-error value', () => {
    expect(describeDbError(undefined).summary).toBe('error=unknown')
    expect(describeDbError('boom').summary).toBe('error=unknown')
  })
})
