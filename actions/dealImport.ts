'use server'

import * as XLSX from 'xlsx'
import type { Knex } from 'knex'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireProductAccess } from '@/lib/requireUser'
import { assertLeadQuota, QuotaExceededError, withAgencyQuotaLock } from '@/lib/quota'
import { track, trackFirstRealLeadOnce } from '@/lib/analytics/track'
import { calculateCommission } from '@/components/sales/saleForm/funcs/calcCmsn'
import { insertSaleUsers } from '@/components/sales/saleForm/funcs/insertSale'
import {
  checkDealRow,
  isRejected,
  mapDealImportRows,
  type DealImportRow,
  type DealMappingResult,
  type RejectedDealRow,
} from '@/lib/deals/importMapping'

/**
 * Excel import of עסקאות.
 *
 * DELIBERATELY NOT `insertSale`. That action is "close a live deal": it moves
 * the lead to `closed` and emits `status_changed`, which drives customer-facing
 * automations. An import is historical data entry, so this writes the same
 * `sales` + `sale_users` rows the form writes and nothing else — the lead's
 * status is never touched and no automation or notification is emitted.
 *
 * ATOMIC. Matching, new-lead creation, duplicate detection and the deal writes
 * all run in ONE transaction under the agency quota lock `addLeads` uses. A
 * failure anywhere rolls back every lead and deal this import created, so a
 * deal that cannot be saved never leaves an orphan lead behind. `addLeads`
 * itself cannot join a caller's transaction, so the new-lead insert below uses
 * its primitives (lock, `assertLeadQuota`, the same row shape) instead.
 */

export type DealImportResult =
  | { imported: number; duplicates: number; createdLeads: number; rejected: RejectedDealRow[] }
  | { error: 'quota_exceeded'; current: number; limit: number; attempted: number }

/** The manual form's submitted defaults for the fields the import does not carry. */
const DEAL_DEFAULTS = { company: 'ללא ספק', branch: 'שירותים', action: 'מכירה', prdctType: 'תשלום חד פעמי' }
/** A product value every branch's list contains; used when the sheet names none. */
const DEFAULT_PRDCT = 'אחר'

export async function uploadDealData(file: File): Promise<DealMappingResult> {
  await requireProductAccess()
  const buf = Buffer.from(await file.arrayBuffer())
  const workbook = XLSX.read(buf, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const json = sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]) : []
  return mapDealImportRows(json[0] ?? [], json.slice(1))
}

/** Every stored spelling of an Israeli number: `05…` (Excel/paste) and `972…` (CSV). */
function phoneForms(phone: string): string[] {
  const digits = phone.replace(/\D/g, '')
  if (/^0\d{8,9}$/.test(digits)) return [digits, '972' + digits.slice(1), '+972' + digits.slice(1)]
  return [phone]
}

/** Lead ids for each row's phone (first) or email, inside ONE agency only. */
async function matchLeads(q: Knex, agencyId: number, rows: DealImportRow[]): Promise<Map<DealImportRow, number>> {
  const phones = [...new Set(rows.flatMap((r) => (r.phone ? phoneForms(r.phone) : [])))]
  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean) as string[])]

  const byPhone = new Map<string, number>()
  const byEmail = new Map<string, number>()
  if (phones.length) {
    const found = await q('clients').where({ agencyId }).whereIn('phone', phones).orderBy('id').select('id', 'phone')
    for (const c of found) if (!byPhone.has(c.phone)) byPhone.set(c.phone, c.id)
  }
  if (emails.length) {
    const found = await q('clients')
      .where({ agencyId })
      .whereRaw('lower("email") = ANY(?)', [emails])
      .orderBy('id')
      .select('id', 'email')
    for (const c of found) if (!byEmail.has(c.email.toLowerCase())) byEmail.set(c.email.toLowerCase(), c.id)
  }

  const res = new Map<DealImportRow, number>()
  for (const r of rows) {
    const id = (r.phone && phoneForms(r.phone).map((p) => byPhone.get(p)).find(Boolean)) || (r.email && byEmail.get(r.email))
    if (id) res.set(r, Number(id))
  }
  return res
}

const dealKey = (clientId: number, r: { amount: number; saleDt: string | null; prdct: string }) =>
  `${clientId}|${Number(r.amount)}|${r.saleDt ?? ''}|${r.prdct}`

export async function importDeals(input: unknown[]): Promise<DealImportResult> {
  const user = await requireProductAccess()
  const agencyId = user.agencyId

  // Rows come back from the client: re-validate every one.
  const rejected: RejectedDealRow[] = []
  const rows: DealImportRow[] = []
  for (const raw of Array.isArray(input) ? input : []) {
    const r = (raw ?? {}) as Record<string, unknown>
    const res = checkDealRow(Number(r.row) || 0, r)
    if (isRejected(res)) rejected.push(res)
    else rows.push(res)
  }

  let outcome: { imported: number; duplicates: number; createdLeads: number }
  try {
    outcome = await withAgencyQuotaLock(agencyId, (trx) => writeImport(trx, user, rows, rejected))
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return { error: 'quota_exceeded', current: error.current, limit: error.limit, attempted: error.attempted }
    }
    throw error
  }
  const { imported, duplicates, createdLeads } = outcome

  // No revalidatePath here: a revalidating action re-renders /deals in its
  // response, which remounts SalesTable (keyed on its data) and closes the
  // importer before its result can be read. The importer calls
  // `revalidateDealImport` when it closes instead.
  if (createdLeads) {
    // The same post-commit signal addLeads emits for an Excel lead import.
    after(() => track({ agencyId, userId: user.id, event: 'leads_imported', props: { count: createdLeads, format: 'excel' } }))
    after(() => trackFirstRealLeadOnce(agencyId, 'import'))
  }

  return { imported, duplicates, createdLeads, rejected: rejected.sort((a, b) => a.row - b.row) }
}

/** Called by the importer when it closes, after a successful import. */
export async function revalidateDealImport() {
  await requireProductAccess()
  revalidatePath('/deals')
  revalidatePath('/sum_sales')
  revalidatePath('/leads')
}

/** Everything that writes, on ONE transaction. Throws to roll it all back. */
async function writeImport(
  trx: Knex.Transaction,
  user: { id: number; agencyId: number },
  rows: DealImportRow[],
  rejected: RejectedDealRow[],
) {
  const agencyId = user.agencyId
  const leadByRow = await matchLeads(trx, agencyId, rows)

  // Unmatched rows: create a lead only when there is a name AND a phone.
  const toCreate = new Map<string, Record<string, unknown>>()
  for (const r of rows) {
    if (leadByRow.has(r)) continue
    if (r.firstName && r.phone) {
      if (!toCreate.has(r.phone)) {
        // addLeads' row shape for an imported lead.
        toCreate.set(r.phone, {
          handlerId: user.id,
          userId: user.id,
          lead: true,
          firstName: r.firstName,
          lastName: r.lastName ?? '',
          phone: r.phone,
          ...(r.email ? { email: r.email } : {}),
          createdById: user.id,
          status: 'new',
          agencyId,
          createOrigin: 'import',
        })
      }
    } else {
      rejected.push({ row: r.row, reason: 'לא נמצא ליד תואם, וכדי ליצור ליד חדש צריך שם וטלפון', label: r.phone || r.email || '' })
    }
  }

  if (toCreate.size) {
    await assertLeadQuota(agencyId, toCreate.size, trx)
    await trx('clients').insert([...toCreate.values()])
    const created = await matchLeads(trx, agencyId, rows.filter((r) => !leadByRow.has(r) && r.firstName && r.phone))
    created.forEach((id, r) => leadByRow.set(r, id))
  }

  const ready = rows.filter((r) => leadByRow.has(r)).map((r) => ({ ...r, prdct: r.prdct ?? DEFAULT_PRDCT, clientId: leadByRow.get(r)! }))

  // Duplicates: against this agency's existing deals, and within the file.
  const clientIds = [...new Set(ready.map((r) => r.clientId))]
  const existing = clientIds.length
    ? await trx('sales')
        .where({ agencyId })
        .whereIn('clientId', clientIds)
        .select('clientId', 'amount', 'prdct', trx.raw(`to_char("saleDt", 'YYYY-MM-DD') AS "saleDt"`))
    : []
  const seen = new Set(
    (existing as { clientId: number; amount: number; prdct: string; saleDt: string | null }[]).map((s) => dealKey(Number(s.clientId), s)),
  )
  let duplicates = 0
  const toInsert = ready.filter((r) => {
    const key = dealKey(r.clientId, r)
    if (seen.has(key)) return (duplicates++, false)
    seen.add(key)
    return true
  })

  const now = new Date()
  const users = { userId: String(user.id) }
  for (const r of toInsert) {
    const sale = {
      ...DEAL_DEFAULTS,
      status: r.status,
      prdct: r.prdct,
      amount: r.amount,
      saleDt: r.saleDt,
      offrDt: now,
      notes: r.notes,
      clientId: r.clientId,
      handlerId: user.id,
      createdById: user.id,
      agencyId,
    }
    const cmsnRes = calculateCommission(sale, [], users)
    const [{ id }] = await trx('sales').insert({ ...sale, cmsn: cmsnRes.cmsn }).returning('id')
    await insertSaleUsers(trx, id, users, cmsnRes, { user: {}, user2: {} })
  }

  return { imported: toInsert.length, duplicates, createdLeads: toCreate.size }
}
