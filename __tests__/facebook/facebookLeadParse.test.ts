/**
 * Name, phone and email from a Lead Ads `field_data` array.
 *
 * `clients.firstName` and `clients.lastName` are NOT NULL, so the parser must
 * always produce strings — an absent surname is '' (the convention every other
 * lead path already uses), never null. Meta forms carry either one `full_name`
 * or the standard `first_name` / `last_name` pair.
 */
import { describe, expect, it } from 'vitest'
import { parseFacebookLead } from '@/lib/adapters/facebookLead'

const f = (name: string, value: string) => ({ name, values: [value] })

describe('parseFacebookLead', () => {
  it('splits a full name', () => {
    expect(parseFacebookLead([f('full_name', 'דוד בן חיים')])).toMatchObject({ firstName: 'דוד', lastName: 'בן חיים' })
  })

  it('a one-word name gives an empty surname, never null', () => {
    expect(parseFacebookLead([f('full_name', 'נועה')])).toMatchObject({ firstName: 'נועה', lastName: '' })
  })

  it('reads the standard first_name / last_name fields', () => {
    expect(parseFacebookLead([f('first_name', 'דנה'), f('last_name', 'לוי')])).toMatchObject({
      firstName: 'דנה',
      lastName: 'לוי',
    })
  })

  it('no name at all: the placeholder first name and an empty surname', () => {
    expect(parseFacebookLead([f('email', 'a@b.co')])).toEqual({
      firstName: 'ליד מפייסבוק',
      lastName: '',
      phone: null,
      email: 'a@b.co',
    })
  })

  it('phone and email are unchanged', () => {
    expect(parseFacebookLead([f('full_name', 'א ב'), f('phone_number', '+972501234567'), f('email', 'x@y.co')])).toMatchObject({
      phone: '+972501234567',
      email: 'x@y.co',
    })
  })

  it('malformed input still yields a savable lead', () => {
    expect(parseFacebookLead(null as never)).toEqual({ firstName: 'ליד מפייסבוק', lastName: '', phone: null, email: null })
  })
})
