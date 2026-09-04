import { isIdNumValid } from '@/lib/funcs'
// Value import. `pastedLeads` imports only the TYPE back from here, which is
// erased at compile time, so there is no runtime cycle.
import { normalizePhone } from '@/lib/leads/pastedLeads'

/**
 * Spreadsheet import mapping — headers to lead fields.
 *
 * WHY THIS EXISTS, AND WHAT IT REPLACES.
 *
 * The previous mapper lived inline in `uploadLeadData` and encoded an insurance
 * product's assumptions, not this one's. It required three exact headers —
 * `שם פרטי`, `שם משפחה`, `תעודת זהות` — erroring the whole file if any was
 * missing; it validated an Israeli national ID checksum on every row; it never
 * mapped a phone number at all; and its header loop ended in a bare
 * `isOk = false`, so a single unrecognised column (`הערות`, `מקור`, anything)
 * silently discarded every row in the file.
 *
 * SocialCRM's user gets leads from Facebook ads, Instagram DMs and WhatsApp.
 * Those leads have a name and a phone number. They do not have a national ID.
 * `product.md` §7 calls this import the product's first success moment — "within
 * 60 seconds they can see all their leads organized in one place" — and in
 * production it had been used twice, ever, by one agency. It was not
 * under-discovered; for the target user it was impossible.
 *
 * WHAT IS PRESERVED. Files that DID work still work: `תעודת זהות` is still
 * recognised and still checksum-validated, and a name+id row still imports
 * exactly as before. The change is additive — the id became optional, the phone
 * became mappable, and unknown columns became ignorable.
 *
 * Terminology per `ux-guidelines.md` §6: this module speaks of לידים only.
 */

export type LeadImportRow = {
  firstName?: string
  lastName?: string
  phone?: string
  idNum?: string
  email?: string
}

export type ImportMappingResult = {
  data: LeadImportRow[]
  wrongData: LeadImportRow[]
  error?: string
}

/** Header spellings seen in real customer files, normalised to one field. */
const HEADER_ALIASES: Record<string, keyof LeadImportRow> = {
  'שם פרטי': 'firstName',
  'שם': 'firstName',
  'first name': 'firstName',
  firstname: 'firstName',
  'שם משפחה': 'lastName',
  'last name': 'lastName',
  lastname: 'lastName',
  'טלפון': 'phone',
  'נייד': 'phone',
  'מספר טלפון': 'phone',
  'מס טלפון': 'phone',
  'phone': 'phone',
  mobile: 'phone',
  'תעודת זהות': 'idNum',
  'ת.ז.': 'idNum',
  'ת"ז': 'idNum',
  'אימייל': 'email',
  'מייל': 'email',
  'דואר אלקטרוני': 'email',
  email: 'email',
}

function normalizeHeader(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

function cell(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

/**
 * Map a sheet's header row + data rows into lead rows.
 *
 * A row is VALID when it has a first name and at least one way to reach the
 * lead (phone or national id). That is the honest minimum: a lead you cannot
 * contact is not a lead, and `product.md` names calling as the whole job.
 *
 * A row that is entirely blank is skipped, not reported as invalid — trailing
 * blank rows are an artifact of how spreadsheets are saved, not a user error
 * worth showing back to them.
 */
export function mapImportRows(headers: unknown[], rows: unknown[][]): ImportMappingResult {
  const fields = (headers ?? []).map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null)

  // The file is unusable only when NOTHING maps. Naming the columns we accept is
  // more useful than naming the ones we did not find.
  if (!fields.some(Boolean)) {
    return {
      data: [],
      wrongData: [],
      error: 'לא זיהינו עמודות מתאימות בקובץ. צריך עמודת שם, ולפחות עמודת טלפון.',
    }
  }

  const data: LeadImportRow[] = []
  const wrongData: LeadImportRow[] = []

  for (const row of rows ?? []) {
    if (!row?.length) continue

    const mapped: LeadImportRow = {}
    let anyValue = false

    fields.forEach((field, index) => {
      if (!field) return // unrecognised column: ignored, never fatal
      const value = cell(row[index])
      if (!value) return
      anyValue = true
      // The id is carried only when it is genuinely valid. An invalid one is
      // dropped rather than failing the row, so a lead with a good phone and a
      // typo'd id still imports.
      if (field === 'idNum' && !isIdNumValid(value)) return
      /**
       * Store phones in ONE shape, the same one the paste path produces.
       * A cell reading "054-111-0005" was previously stored verbatim while the
       * same number pasted became "0541110005"; `addLeads` dedupes on the exact
       * string, so the two would have become two separate לידים. An
       * unrecognisable number is kept as typed rather than dropped — the lead is
       * still worth having, and refusing it would lose the customer's data.
       */
      if (field === 'phone') {
        mapped.phone = normalizePhone(value) ?? value
        return
      }
      mapped[field] = value
    })

    if (!anyValue) continue // blank row

    const reachable = Boolean(mapped.phone || mapped.idNum)
    if (mapped.firstName && reachable) data.push(mapped)
    else wrongData.push(mapped)
  }

  return { data, wrongData }
}
