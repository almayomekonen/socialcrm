import type { LeadImportRow } from '@/lib/leads/importMapping'

/**
 * Parse a pasted column of leads.
 *
 * WHY A PASTE PATH EXISTS AT ALL. 62.5% of this product's signups arrive on a
 * phone, and a measurable share of those land inside Facebook's in-app browser.
 * There, a native file picker is a wall — there is no spreadsheet on the device
 * to pick. The list the user actually has is a column of numbers in WhatsApp,
 * in Notes, or in a message they sent themselves, and that they can paste.
 *
 * It is the SAME import, not a lesser one: rows go through `addLeads` exactly
 * like a spreadsheet's, with the same quota, the same dedupe, and the same
 * `leads_imported` event carrying `format: 'paste'`.
 *
 * HONESTY. Anything unreadable is counted in `skipped` and shown back to the
 * user. A parser that silently drops a customer's leads is worse than one that
 * refuses them (`care-charter.md` Law 1).
 */

/** One page may not attempt an unbounded insert. Well above any real paste. */
const MAX_ROWS = 1000

/** Israeli mobile/landline shapes, after separators are stripped. */
const LOCAL_RE = /^0\d{8,9}$/
const INTL_RE = /^972\d{8,9}$/

/** Placeholder for a number pasted with no name. Never blank — a nameless row
 *  renders as an empty lead card and reads like a bug. */
const UNNAMED = 'ליד'

/**
 * Exported so the SPREADSHEET mapper stores phones in the same shape this does.
 * Browser QA caught the divergence: a cell reading "054-111-0005" was stored
 * verbatim while the same number pasted became "0541110005", so `addLeads`
 * (which dedupes on the exact phone string) would have inserted both as two
 * separate לידים.
 */
export function normalizePhone(raw: string): string | null {
  // Keep digits and a leading +; drop spaces, dashes, dots, parentheses.
  const digits = raw.replace(/[^\d+]/g, '').replace(/^\+/, '')
  if (!digits) return null
  if (INTL_RE.test(digits)) return '0' + digits.slice(3)
  if (LOCAL_RE.test(digits)) return digits
  return null
}

/** Split a name into first/last without inventing structure beyond one space. */
function splitName(raw: string): { firstName: string; lastName?: string } {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: UNNAMED }
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export type PastedLeadsResult = {
  rows: LeadImportRow[]
  /** Non-blank lines that carried no readable phone number. */
  skipped: number
  /** True when the paste exceeded MAX_ROWS and was cut. */
  truncated: boolean
}

export function parsePastedLeads(text: string): PastedLeadsResult {
  const rows: LeadImportRow[] = []
  const seen = new Set<string>()
  let skipped = 0
  let truncated = false

  const lines = (text ?? '').split(/[\r\n]+/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue // blank lines are formatting, not errors

    if (rows.length >= MAX_ROWS) {
      truncated = true
      break
    }

    // A row is at most "name<sep>phone" or "phone<sep>name". Tab, comma and
    // semicolon are the separators real pastes use (spreadsheet, CSV, manual).
    const cells = trimmed.split(/[\t,;]+/).map((c) => c.trim()).filter(Boolean)

    let phone: string | null = null
    const nameParts: string[] = []
    for (const c of cells) {
      const p = normalizePhone(c)
      // First readable number wins; anything else is treated as name text.
      if (p && !phone) phone = p
      else nameParts.push(c)
    }

    if (!phone) {
      skipped++
      continue
    }
    if (seen.has(phone)) continue // duplicate inside the same paste
    seen.add(phone)

    rows.push({ ...splitName(nameParts.join(' ')), phone })
  }

  return { rows, skipped, truncated }
}
