import { describe, it, expect } from 'vitest'
import { mapDealImportRows, parseSaleDate, parseStatus, parseAmount } from '@/lib/deals/importMapping'

describe('mapDealImportRows — deal spreadsheet mapping', () => {
  it('maps Hebrew headers', () => {
    const res = mapDealImportRows(
      ['שם', 'טלפון', 'סכום עסקה', 'סטטוס', 'תאריך עסקה', 'שירות', 'הערות'],
      [['דנה לוי', '054-111-0005', '1,500 ₪', 'סגור', '15/03/2026', 'בניית אתר', 'שולם בהעברה']],
    )
    expect(res.error).toBeUndefined()
    expect(res.wrongData).toEqual([])
    expect(res.data).toEqual([
      {
        row: 2,
        firstName: 'דנה',
        lastName: 'לוי',
        phone: '0541110005',
        email: null,
        amount: 1500,
        status: 'שולם',
        saleDt: '2026-03-15',
        prdct: 'בניית אתר',
        notes: 'שולם בהעברה',
      },
    ])
  })

  it('maps English headers, including an Excel date serial', () => {
    const res = mapDealImportRows(
      ['Full Name', 'Email', 'Amount', 'Status', 'Deal Date', 'Product'],
      [['Dana Levi', 'DANA@Example.com', 900, 'lost', 46096, 'SEO']],
    )
    expect(res.data).toHaveLength(1)
    expect(res.data[0]).toMatchObject({
      firstName: 'Dana',
      lastName: 'Levi',
      email: 'dana@example.com',
      amount: 900,
      status: 'בוטל',
      saleDt: '2026-03-15',
      prdct: 'SEO',
    })
  })

  it('ignores unknown columns', () => {
    const res = mapDealImportRows(['סכום', 'עמודה אחרת', 'טלפון', 'utm'], [[200, 'x', '0521234567', 'fb']])
    expect(res.wrongData).toEqual([])
    expect(res.data[0]).toMatchObject({ amount: 200, phone: '0521234567', status: 'חדש', saleDt: null, prdct: null })
  })

  it('rejects invalid amount, status and date rows but keeps the valid ones', () => {
    const res = mapDealImportRows(
      ['טלפון', 'סכום', 'סטטוס', 'תאריך'],
      [
        ['0521111111', 'abc', '', ''],
        ['0522222222', 0, '', ''],
        ['0523333333', 20_000_000, '', ''],
        ['0524444444', 100, 'משהו אחר', ''],
        ['0525555555', 100, '', '31/02/2026'],
        ['0526666666', 100, '', 'yesterday'],
        ['0527777777', 100, 'שולם', '2026-01-01'],
      ],
    )
    expect(res.data.map((r) => r.row)).toEqual([8])
    expect(res.wrongData.map((r) => [r.row, r.reason])).toEqual([
      [2, 'סכום חסר או לא תקין'],
      [3, 'סכום חסר או לא תקין'],
      [4, 'סכום חסר או לא תקין'],
      [5, 'סטטוס לא מוכר: משהו אחר'],
      [6, 'תאריך לא תקין: 31/02/2026'],
      [7, 'תאריך לא תקין: yesterday'],
    ])
  })

  it('rejects a row with no phone and no email', () => {
    const res = mapDealImportRows(['שם', 'סכום', 'טלפון'], [['דנה', 100, '']])
    expect(res.data).toEqual([])
    expect(res.wrongData[0]).toMatchObject({ row: 2, reason: 'חסר טלפון או מייל לזיהוי הליד', label: 'דנה' })
  })

  it('skips blank rows silently', () => {
    const res = mapDealImportRows(['סכום', 'טלפון'], [[], [null, ''], [100, '0521234567']])
    expect(res.data).toHaveLength(1)
    expect(res.wrongData).toEqual([])
  })

  it('fails the file only when the amount or contact column is missing', () => {
    expect(mapDealImportRows(['שם', 'טלפון'], [['דנה', '0521234567']]).error).toBeTruthy()
    expect(mapDealImportRows(['שם', 'סכום'], [['דנה', 100]]).error).toBeTruthy()
  })
})

describe('field parsers', () => {
  it('status accepts stored, display, legacy and English values', () => {
    expect(parseStatus('במו״מ')).toBe('במו"מ')
    expect(parseStatus('בטיפול')).toBe('בהצעה')
    expect(parseStatus('הושלם')).toBe('שולם')
    expect(parseStatus('Paid')).toBe('שולם')
    expect(parseStatus('')).toBe('חדש')
    expect(parseStatus('xyz')).toBeNull()
  })

  it('date parses ISO, DD/MM/YYYY and DD.MM.YYYY, and rejects impossible dates', () => {
    expect(parseSaleDate('2026-3-5')).toBe('2026-03-05')
    expect(parseSaleDate('5.3.2026')).toBe('2026-03-05')
    expect(parseSaleDate('')).toBeNull()
    expect(parseSaleDate('13/13/2026')).toBeUndefined()
  })

  it('amount strips currency formatting', () => {
    expect(parseAmount('₪ 1,234.50')).toBe(1234.5)
    expect(parseAmount('2500 ש"ח')).toBe(2500)
    expect(parseAmount(-5)).toBeNull()
  })
})
