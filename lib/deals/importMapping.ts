import { STATUS_LIST, normalizeStatus } from '@/types/lists'
import { normalizePhone } from '@/lib/leads/pastedLeads'

/**
 * Spreadsheet import mapping for עסקאות — headers to deal fields.
 *
 * The deal-side sibling of `lib/leads/importMapping.ts`, built the same way:
 * alias-based headers (Hebrew and English), unknown columns ignored, and a bad
 * ROW is reported back instead of failing the file. Pure — no DB, no session —
 * so the server action can run it twice: once on the uploaded sheet, and again
 * (`checkDealRow`) on the rows the client sends back for the actual import.
 */

export type DealImportRow = {
  /** 1-based spreadsheet row number, so a rejection can point at the line. */
  row: number
  amount: number
  status: string
  /** `YYYY-MM-DD`, or null when the sheet has no date for the deal. */
  saleDt: string | null
  prdct: string | null
  notes: string | null
  phone: string | null
  email: string | null
  firstName: string | null
  lastName: string | null
}

export type RejectedDealRow = { row: number; reason: string; label: string }

export type DealMappingResult = { data: DealImportRow[]; wrongData: RejectedDealRow[]; error?: string }

type Field = 'amount' | 'phone' | 'email' | 'name' | 'firstName' | 'lastName' | 'status' | 'saleDt' | 'prdct' | 'notes'

const HEADER_ALIASES: Record<string, Field> = {
  'סכום': 'amount', 'סכום עסקה': 'amount', 'סכום העסקה': 'amount', 'מחיר': 'amount', 'שולם': 'amount',
  amount: 'amount', price: 'amount', total: 'amount', value: 'amount', 'deal amount': 'amount',
  'טלפון': 'phone', 'נייד': 'phone', 'מספר טלפון': 'phone', 'מס טלפון': 'phone',
  phone: 'phone', mobile: 'phone', 'phone number': 'phone',
  'מייל': 'email', 'אימייל': 'email', 'כתובת מייל': 'email', 'דואר אלקטרוני': 'email', email: 'email', 'e-mail': 'email',
  'שם': 'name', 'שם מלא': 'name', 'שם לקוח': 'name', 'לקוח': 'name', 'שם ליד': 'name', 'ליד': 'name',
  name: 'name', 'full name': 'name', customer: 'name', 'customer name': 'name', client: 'name', lead: 'name',
  'שם פרטי': 'firstName', 'first name': 'firstName', firstname: 'firstName',
  'שם משפחה': 'lastName', 'last name': 'lastName', lastname: 'lastName',
  'סטטוס': 'status', 'שלב': 'status', 'שלב בצנרת': 'status', status: 'status', stage: 'status',
  'תאריך': 'saleDt', 'תאריך עסקה': 'saleDt', 'תאריך סגירה': 'saleDt', 'תאריך חיוב': 'saleDt',
  date: 'saleDt', 'deal date': 'saleDt', 'sale date': 'saleDt', 'close date': 'saleDt',
  'שם עסקה': 'prdct', 'עסקה': 'prdct', 'תיאור עסקה': 'prdct', 'שירות': 'prdct', 'מוצר': 'prdct', 'מוצר / שירות': 'prdct',
  deal: 'prdct', 'deal name': 'prdct', product: 'prdct', service: 'prdct', transaction: 'prdct',
  'הערות': 'notes', 'הערה': 'notes', notes: 'notes', note: 'notes',
}

/**
 * Status words a user may type, mapped to the stored `STATUS_LIST` value. The
 * UI shows stored values through `DEAL_STATUS_DISPLAY_MAP` (חדש/בטיפול/סגור/
 * אבוד), so the display words are accepted as well as the stored ones.
 */
const STATUS_ALIASES: Record<string, string> = {
  ...Object.fromEntries(STATUS_LIST.map((s) => [s, s])),
  'בטיפול': 'בהצעה',
  'סגור': 'שולם',
  'אבוד': 'בוטל',
  'ממתין לפרטים': 'חדש',
  // Payment-processor exports (e.g. a Grow/Meshulam "עסקאות" sheet): a charged
  // payment is a paid deal; a charged-back one is a cancelled deal.
  'חוייב': 'שולם',
  'חויב': 'שולם',
  'העסקה הוכחשה': 'בוטל',
  'הכחשת עסקה': 'בוטל',
  new: 'חדש',
  'in progress': 'בהצעה', proposal: 'בהצעה',
  negotiation: 'במו"מ',
  'pending payment': 'ממתין לתשלום',
  paid: 'שולם', won: 'שולם', closed: 'שולם',
  lost: 'בוטל', cancelled: 'בוטל', canceled: 'בוטל',
}

/** Same ceiling the manual deal form enforces (`isAmountHigh`). */
const MAX_DEAL_AMOUNT = 10_000_000
const DEFAULT_STATUS = 'חדש'

/**
 * Header spellings vary in ways that carry no meaning: surrounding or doubled
 * whitespace (incl. NBSP), `_` for space, and ASCII vs Hebrew quote marks
 * (`סה"כ` / `סה״כ` / `סהכ`). All are folded away before the alias lookup.
 */
function normalizeHeader(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/["'״׳]/g, '')
    .replace(/[_\s\u00a0]+/g, ' ')
    .trim()
    .toLowerCase()
}

function cell(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

export function parseAmount(raw: unknown): number | null {
  const n =
    typeof raw === 'number'
      ? raw
      : Number(cell(raw).replace(/₪|ש"ח|ש״ח|nis|ils|,|\s/gi, ''))
  if (!Number.isFinite(n) || n <= 0 || n > MAX_DEAL_AMOUNT) return null
  return Math.round(n * 100) / 100
}

/** Blank → default status; an unrecognised word → null (the row is rejected). */
export function parseStatus(raw: unknown): string | null {
  const v = cell(raw).replace(/״/g, '"')
  if (!v) return DEFAULT_STATUS
  const known = STATUS_ALIASES[v] ?? STATUS_ALIASES[v.toLowerCase()]
  if (known) return known
  // Legacy stored values (`STATUS_LEGACY_MAP`). normalizeStatus maps anything it
  // does not know to 'חדש', so only a NON-default answer proves recognition.
  const legacy = normalizeStatus(v)
  return legacy !== DEFAULT_STATUS ? legacy : null
}

function ymd(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Blank → null (a deal without a date is allowed, like the manual form); a value
 * that is not a real date → undefined (the row is rejected). Accepts Excel date
 * serials, which is how `sheet_to_json` returns a date-formatted cell, and the
 * text forms DD/MM/YYYY, DD/MM/YY, DD.MM.YYYY and YYYY-MM-DD. Computed in UTC so the
 * server's timezone cannot shift the day.
 */
export function parseSaleDate(raw: unknown): string | null | undefined {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return undefined
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86_400_000)
    return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) ?? undefined
  }
  const v = cell(raw)
  if (!v) return null
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return ymd(+m[1], +m[2], +m[3]) ?? undefined
  // DD/MM/YYYY, or DD/MM/YY as payment exports write it (YY → 20YY).
  m = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/)
  if (m) return ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]) ?? undefined
  return undefined
}

function rowLabel(r: Partial<DealImportRow>): string {
  return [r.firstName, r.lastName].filter(Boolean).join(' ') || r.phone || r.email || ''
}

/**
 * Validate one row's raw field values into a DealImportRow, or a rejection.
 * Used for the uploaded sheet AND, server-side, for rows returned by the client,
 * which are untrusted input.
 */
export function checkDealRow(row: number, v: Partial<Record<Field, unknown>>): DealImportRow | RejectedDealRow {
  const name = cell(v.name).split(/\s+/).filter(Boolean)
  const rawPhone = cell(v.phone)
  const email = cell(v.email).toLowerCase()
  const parsed: Partial<DealImportRow> = {
    firstName: cell(v.firstName) || name[0] || null,
    lastName: cell(v.lastName) || name.slice(1).join(' ') || null,
    phone: rawPhone ? (normalizePhone(rawPhone) ?? rawPhone) : null,
    email: email || null,
  }
  const reject = (reason: string): RejectedDealRow => ({ row, reason, label: rowLabel(parsed) })

  const amount = parseAmount(v.amount)
  if (amount === null) return reject('סכום חסר או לא תקין')
  const status = parseStatus(v.status)
  if (status === null) return reject(`סטטוס לא מוכר: ${cell(v.status)}`)
  const saleDt = parseSaleDate(v.saleDt)
  if (saleDt === undefined) return reject(`תאריך לא תקין: ${cell(v.saleDt)}`)
  if (!parsed.phone && !parsed.email) return reject('חסר טלפון או מייל לזיהוי הליד')

  return {
    ...(parsed as DealImportRow),
    row,
    amount,
    status,
    saleDt,
    prdct: cell(v.prdct) || null,
    notes: cell(v.notes) || null,
  }
}

export function isRejected(r: DealImportRow | RejectedDealRow): r is RejectedDealRow {
  return 'reason' in r
}

/** HEADER_ALIASES keyed by the same normalisation the sheet headers get. */
const ALIASES = new Map(Object.entries(HEADER_ALIASES).map(([k, v]) => [normalizeHeader(k), v]))

/** Map a sheet's header row + data rows into deal rows. */
export function mapDealImportRows(headers: unknown[], rows: unknown[][]): DealMappingResult {
  const fields = (headers ?? []).map((h) => ALIASES.get(normalizeHeader(h)) ?? null)

  if (!fields.includes('amount') || !(fields.includes('phone') || fields.includes('email'))) {
    return {
      data: [],
      wrongData: [],
      error: 'לא זיהינו עמודות מתאימות בקובץ. צריך עמודת סכום, ועמודת טלפון או מייל.',
    }
  }

  const data: DealImportRow[] = []
  const wrongData: RejectedDealRow[] = []

  ;(rows ?? []).forEach((r, i) => {
    if (!r?.length) return
    const values: Partial<Record<Field, unknown>> = {}
    fields.forEach((field, index) => {
      if (field && cell(r[index])) values[field] = r[index]
    })
    if (!Object.keys(values).length) return // blank row: skipped, not an error

    const res = checkDealRow(i + 2, values)
    if (isRejected(res)) wrongData.push(res)
    else data.push(res)
  })

  return { data, wrongData }
}
