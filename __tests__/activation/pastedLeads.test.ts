import { describe, it, expect } from 'vitest'
import { parsePastedLeads } from '@/lib/leads/pastedLeads'

/**
 * Pasting a column of phone numbers is the import path for a phone.
 *
 * 62.5% of this product's signups arrive on a phone, a measurable share of them
 * inside Facebook's in-app browser, where a native file picker is a wall: there
 * is no spreadsheet on the device to pick. The list the user DOES have is a
 * column of numbers in WhatsApp, Notes, or a message to themselves — which they
 * can select and paste.
 *
 * This parser is deliberately permissive about shape and strict about what it
 * claims: anything it cannot read becomes `skipped`, reported to the user, and
 * never silently dropped.
 */
describe('parsePastedLeads', () => {
  it('parses a plain column of numbers', () => {
    const res = parsePastedLeads('0521234567\n0537654321\n0549876543')
    expect(res.rows).toHaveLength(3)
    expect(res.rows[0].phone).toBe('0521234567')
    expect(res.skipped).toBe(0)
  })

  it('parses "name, phone" and keeps the name', () => {
    const res = parsePastedLeads('דנה לוי, 0521234567')
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]).toMatchObject({ firstName: 'דנה', lastName: 'לוי', phone: '0521234567' })
  })

  it('parses "phone, name" in either order', () => {
    const res = parsePastedLeads('0521234567, דנה')
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]).toMatchObject({ firstName: 'דנה', phone: '0521234567' })
  })

  it('accepts tab-separated pastes from a spreadsheet', () => {
    const res = parsePastedLeads('דנה\t0521234567\nיוסי\t0537654321')
    expect(res.rows).toHaveLength(2)
    expect(res.rows[1]).toMatchObject({ firstName: 'יוסי', phone: '0537654321' })
  })

  it('normalises separators and international prefixes to one stored form', () => {
    const res = parsePastedLeads('052-123-4567\n+972521234599\n052 123 4588')
    expect(res.rows.map((r) => r.phone)).toEqual(['0521234567', '0521234599', '0521234588'])
  })

  it('collapses duplicates inside the same paste', () => {
    const res = parsePastedLeads('0521234567\n052-123-4567\n0537654321')
    expect(res.rows).toHaveLength(2)
  })

  it('counts unreadable lines instead of dropping them silently', () => {
    const res = parsePastedLeads('0521234567\nלא מספר\n123')
    expect(res.rows).toHaveLength(1)
    expect(res.skipped).toBe(2)
  })

  it('ignores blank lines without counting them as skipped', () => {
    const res = parsePastedLeads('0521234567\n\n   \n0537654321')
    expect(res.rows).toHaveLength(2)
    expect(res.skipped).toBe(0)
  })

  it('gives a nameless lead a usable placeholder rather than an empty name', () => {
    const res = parsePastedLeads('0521234567')
    expect(res.rows[0].firstName).toBeTruthy()
  })

  it('returns nothing for empty input', () => {
    expect(parsePastedLeads('')).toEqual({ rows: [], skipped: 0, truncated: false })
    expect(parsePastedLeads('   \n  ')).toEqual({ rows: [], skipped: 0, truncated: false })
  })

  it('caps a paste so one page cannot attempt an unbounded insert', () => {
    const many = Array.from({ length: 1200 }, (_, i) => `05212${String(i).padStart(5, '0')}`).join('\n')
    const res = parsePastedLeads(many)
    expect(res.rows.length).toBeLessThanOrEqual(1000)
    expect(res.truncated).toBe(true)
  })
})
