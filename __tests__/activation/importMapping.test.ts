import { describe, it, expect } from 'vitest'
import { mapImportRows } from '@/lib/leads/importMapping'

/**
 * The spreadsheet importer is `product.md` §7's "first success moment". In
 * production it has been used twice, ever, by one agency — because it required
 * an Israeli national ID (`תעודת זהות`) on every row, never mapped a phone
 * number, and discarded any row whose sheet carried a column it did not
 * recognise. A Facebook/WhatsApp lead list has a name and a phone and no
 * national ID, so the target user's file could not be imported at all.
 *
 * These tests pin the shape a real social-media lead list actually has, and pin
 * back-compat for the ID-bearing files the old mapper accepted.
 */
describe('mapImportRows — a real social-media lead list', () => {
  it('imports name + phone, the shape every target user actually has', () => {
    const res = mapImportRows(
      ['שם פרטי', 'שם משפחה', 'טלפון'],
      [['דנה', 'לוי', '0521234567']],
    )
    expect(res.error).toBeUndefined()
    expect(res.data).toHaveLength(1)
    expect(res.data[0]).toMatchObject({ firstName: 'דנה', lastName: 'לוי', phone: '0521234567' })
    expect(res.wrongData).toHaveLength(0)
  })

  it('does not require a national ID', () => {
    const res = mapImportRows(['שם פרטי', 'טלפון'], [['דנה', '0521234567']])
    expect(res.error).toBeUndefined()
    expect(res.data).toHaveLength(1)
    expect(res.data[0].idNum).toBeUndefined()
  })

  it('keeps accepting the ID-bearing files the old mapper accepted', () => {
    // 000000018 is a checksum-valid Israeli id.
    const res = mapImportRows(
      ['שם פרטי', 'שם משפחה', 'תעודת זהות'],
      [['דנה', 'לוי', '000000018']],
    )
    expect(res.error).toBeUndefined()
    expect(res.data).toHaveLength(1)
    expect(res.data[0].idNum).toBe('000000018')
  })

  it('ignores unrecognised columns instead of discarding the row', () => {
    const res = mapImportRows(
      ['שם פרטי', 'טלפון', 'הערות פנימיות'],
      [['דנה', '0521234567', 'ליד מקמפיין אוגוסט']],
    )
    expect(res.data).toHaveLength(1)
    expect(res.data[0].phone).toBe('0521234567')
  })

  it('accepts common phone header spellings', () => {
    for (const header of ['טלפון', 'נייד', 'מספר טלפון', 'phone']) {
      const res = mapImportRows(['שם פרטי', header], [['דנה', '0521234567']])
      expect(res.data, `header ${header}`).toHaveLength(1)
      expect(res.data[0].phone, `header ${header}`).toBe('0521234567')
    }
  })

  it('rejects a row with no way to reach the lead', () => {
    const res = mapImportRows(['שם פרטי', 'שם משפחה'], [['דנה', 'לוי']])
    expect(res.data).toHaveLength(0)
    expect(res.wrongData).toHaveLength(1)
  })

  it('rejects a row with no first name', () => {
    const res = mapImportRows(['שם פרטי', 'טלפון'], [['', '0521234567']])
    expect(res.data).toHaveLength(0)
    expect(res.wrongData).toHaveLength(1)
  })

  it('errors only when the file has no usable columns at all', () => {
    const res = mapImportRows(['עמודה'], [['x']])
    expect(res.error).toBeTruthy()
    expect(res.data).toHaveLength(0)
  })

  it('keeps an invalid national ID out of the data but keeps the lead when a phone exists', () => {
    const res = mapImportRows(
      ['שם פרטי', 'טלפון', 'תעודת זהות'],
      [['דנה', '0521234567', '123']],
    )
    expect(res.data).toHaveLength(1)
    // The lead survives on its phone; the bad id is simply not carried through.
    expect(res.data[0].idNum).toBeUndefined()
    expect(res.data[0].phone).toBe('0521234567')
  })

  it('skips fully blank rows without counting them as invalid', () => {
    const res = mapImportRows(['שם פרטי', 'טלפון'], [['', ''], ['דנה', '0521234567']])
    expect(res.data).toHaveLength(1)
    expect(res.wrongData).toHaveLength(0)
  })
})

/**
 * Found in browser QA: an .xlsx cell reading "054-111-0005" was stored verbatim
 * while the same number pasted became "0541110005". `addLeads` dedupes on the
 * exact phone string, so one person would have become two לידים depending on
 * which import path their number arrived through.
 */
describe('mapImportRows — phones are stored in one shape', () => {
  it('normalises a formatted phone the way the paste path does', () => {
    const res = mapImportRows(['שם פרטי', 'טלפון'], [['יעל', '054-111-0005']])
    expect(res.data[0].phone).toBe('0541110005')
  })

  it('normalises an international prefix', () => {
    const res = mapImportRows(['שם פרטי', 'טלפון'], [['יעל', '+972541110005']])
    expect(res.data[0].phone).toBe('0541110005')
  })

  it('keeps an unrecognisable number as typed rather than losing the lead', () => {
    const res = mapImportRows(['שם פרטי', 'טלפון'], [['יעל', '+1 415 555 0100']])
    expect(res.data).toHaveLength(1)
    expect(res.data[0].phone).toBe('+1 415 555 0100')
  })
})
