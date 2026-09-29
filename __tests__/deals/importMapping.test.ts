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

/**
 * The exact header row of a real payment-processor export ("עסקאות" sheet), the
 * file that first failed with "לא זיהינו עמודות מתאימות". Values are synthetic.
 */
const PAYMENT_EXPORT_HEADERS = [
  'חודש חיוב', 'תאריך חיוב', 'שם בית העסק', 'שם', 'כתובת מייל', 'טלפון', 'אמצעי תשלום', 'סוג תשלום',
  'סטטוס', 'תשלומים', 'שולם', 'עמלת אשראי', 'מע"מ', 'סה"כ העברה לבנק', 'אסמכתא', 'אסמכתת מס״ב',
  'מקור תשלום', 'תיאור עסקה', 'תאריך זיכוי לבנק', 'סוג כרטיס', 'כרטיס לקוח', 'האם הופקה חשבונית',
  'אוטומטי', 'שם עמוד פנימי', 'חשבון המעביר', 'שם בעל החשבון', 'שם לחשבונית', 'תעודת זהות', 'כתובת',
]
function exportRow(o: { date: string; name: string; email?: string; phone: string; status: string; paid: number; desc: string }) {
  return [
    'ספטמבר', o.date, 'עסק לדוגמה', o.name, o.email ?? '', o.phone, 'אשראי', 'הו"ק',
    o.status, 'תשלום 1 מתוך 8', o.paid, 1, 0.2, o.paid - 1.2, '500000001', null,
    'עמוד קבוע', o.desc, '10/10/2026', 'ישראלי Visa', '1234', 'לא הופקה', 'לא', null, '', null, '', '', '',
  ]
}

describe('mapDealImportRows — payment-processor export (real header row)', () => {
  it('recognises the export and maps amount, date, status, contact and deal name from the right columns', () => {
    const res = mapDealImportRows(PAYMENT_EXPORT_HEADERS, [
      exportRow({ date: '28/09/26', name: 'דנה לוי', phone: '0521112233', status: 'חוייב', paid: 1500, desc: 'תשלום עבור ליווי' }),
      exportRow({ date: '21/08/26', name: 'יוסי כהן', email: 'Yossi@Example.com', phone: '0524445566', status: 'העסקה הוכחשה', paid: 89, desc: 'מנוי חודשי' }),
      // The chargeback reversal line: a negative amount is not a deal.
      exportRow({ date: '31/08/26', name: 'יוסי כהן', phone: '0524445566', status: 'הכחשת עסקה', paid: -89, desc: 'מנוי חודשי' }),
    ])
    expect(res.error).toBeUndefined()
    expect(res.data).toEqual([
      {
        row: 2, amount: 1500, status: 'שולם', saleDt: '2026-09-28', prdct: 'תשלום עבור ליווי', notes: null,
        phone: '0521112233', email: null, firstName: 'דנה', lastName: 'לוי',
      },
      {
        row: 3, amount: 89, status: 'בוטל', saleDt: '2026-08-21', prdct: 'מנוי חודשי', notes: null,
        phone: '0524445566', email: 'yossi@example.com', firstName: 'יוסי', lastName: 'כהן',
      },
    ])
    // 'שם בית העסק' (the merchant) and 'תאריך זיכוי לבנק' (payout date) are NOT used.
    expect(res.data.every((r) => r.firstName !== 'עסק')).toBe(true)
    expect(res.wrongData).toEqual([{ row: 4, reason: 'סכום חסר או לא תקין', label: 'יוסי כהן' }])
  })

  it('still rejects a charged row whose amount is missing', () => {
    const row = exportRow({ date: '28/09/26', name: 'דנה', phone: '0521112233', status: 'חוייב', paid: 0, desc: 'x' })
    const res = mapDealImportRows(PAYMENT_EXPORT_HEADERS, [row])
    expect(res.data).toEqual([])
    expect(res.wrongData[0].reason).toBe('סכום חסר או לא תקין')
  })

  it('normalises whitespace, NBSP and quote marks in headers', () => {
    const res = mapDealImportRows(['  כתובת\u00a0 מייל ', 'שולם', 'שלב_בצנרת', 'תיאור "עסקה"'], [['a@b.co', 100, 'סגור', 'x']])
    expect(res.error).toBeUndefined()
    expect(res.data[0]).toMatchObject({ email: 'a@b.co', amount: 100, status: 'שולם', prdct: 'x' })
  })
})

describe('field parsers', () => {
  it('status accepts stored, display, legacy and English values', () => {
    expect(parseStatus('במו״מ')).toBe('במו"מ')
    expect(parseStatus('בטיפול')).toBe('בהצעה')
    expect(parseStatus('הושלם')).toBe('שולם')
    expect(parseStatus('Paid')).toBe('שולם')
    expect(parseStatus('')).toBe('חדש')
    expect(parseStatus('חוייב')).toBe('שולם')
    expect(parseStatus('העסקה הוכחשה')).toBe('בוטל')
    expect(parseStatus('xyz')).toBeNull()
  })

  it('date parses ISO, DD/MM/YYYY and DD.MM.YYYY, and rejects impossible dates', () => {
    expect(parseSaleDate('2026-3-5')).toBe('2026-03-05')
    expect(parseSaleDate('5.3.2026')).toBe('2026-03-05')
    expect(parseSaleDate('')).toBeNull()
    expect(parseSaleDate('13/13/2026')).toBeUndefined()
    // DD/MM/YY (payment exports) → 20YY, still calendar-validated.
    expect(parseSaleDate('28/09/26')).toBe('2026-09-28')
    expect(parseSaleDate('31/02/26')).toBeUndefined()
  })

  it('amount strips currency formatting', () => {
    expect(parseAmount('₪ 1,234.50')).toBe(1234.5)
    expect(parseAmount('2500 ש"ח')).toBe(2500)
    expect(parseAmount(-5)).toBeNull()
  })
})
