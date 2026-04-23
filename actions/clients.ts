'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { revalidatePath } from 'next/cache'
import { isIdNumValid } from '@/lib/funcs'
import * as XLSX from 'xlsx'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { assertLeadQuota, QuotaExceededError, getAgencyPlan, withAgencyQuotaLock } from '@/lib/quota'
import type { QuotaErrorResult } from '@/lib/quota'

export type DeleteLeadResult = { success: true } | { error: true; reason: 'no_permission' | 'not_found' }

export type AddLeadsResult = { success: true; inserted: number } | (QuotaErrorResult & { wouldInsert: number })

const CLIENT_WRITABLE_LEAD_FIELDS = new Set<string>([
  'firstName',
  'lastName',
  'idNum',
  'idNumDate',
  'birthDate',
  'gender',
  'familyStatus',
  'familyId',
  'passportNum',
  'licenseNum',
  'phone',
  'secPhone',
  'email',
  'leadSource',
  'handlerId',
  'userId',
  'status',
  'lead',
  'details',
  'rank',
])

function pickLeadFields<T extends Record<string, any>>(data: T): Partial<T> {
  const out: Partial<T> = {}
  if (!data || typeof data !== 'object') return out
  for (const key of Object.keys(data) as (keyof T)[]) {
    if (CLIENT_WRITABLE_LEAD_FIELDS.has(key as string)) out[key] = data[key]
  }
  return out
}

function isLeadTrue(val: unknown): boolean {
  return val === true || val === 'true'
}

async function hardDeleteSalesForClients(trx: import('knex').Knex.Transaction, clientIds: number[], agencyId: number) {
  if (clientIds.length === 0) return
  const saleRows = await trx('sales').whereIn('clientId', clientIds).andWhere({ agencyId }).select('id')
  const saleIds: number[] = saleRows.map((r: any) => Number(r.id))
  if (saleIds.length === 0) return

  await trx('sale_users').whereIn('saleId', saleIds).del()

  await trx('users')
    .whereRaw('"favSaleIds" && ?::integer[]', [saleIds])
    .update({
      favSaleIds: trx.raw(`ARRAY(SELECT UNNEST("favSaleIds") EXCEPT SELECT UNNEST(?::integer[]))`, [saleIds]),
    })

  await trx('sales').whereIn('id', saleIds).del()
}

export async function deleteLead(clientId): Promise<DeleteLeadResult> {
  const user = await requireUser()
  const { gotPermIds } = await getPerms(user)

  const result = await db.transaction(async (trx) => {
    const scopeQ = trx('clients').where({ id: clientId, agencyId: user.agencyId })
    if (!isAdmin(user.role)) scopeQ.whereIn('userId', gotPermIds)
    const scoped = await scopeQ.first('id')

    if (!scoped) {
      const exists = await trx('clients').where({ id: clientId, agencyId: user.agencyId }).first('id')
      return { error: true, reason: exists ? 'no_permission' : 'not_found' } as const
    }

    await hardDeleteSalesForClients(trx, [Number(scoped.id)], user.agencyId)

    await trx('clients').where({ id: clientId, agencyId: user.agencyId }).del()

    return { success: true } as const
  })

  if ('success' in result) revalidatePath('/leads')
  return result
}

export type DeleteManyLeadsResult = {
  deleted: number
  skipped: number
}

export async function deleteManyLeads(ids: number[], leads: boolean = true): Promise<DeleteManyLeadsResult> {
  const user = await requireUser()
  if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0, skipped: 0 }

  const { gotPermIds } = await getPerms(user)

  const result = await db.transaction(async (trx) => {
    const inScopeQ = trx('clients').whereIn('id', ids).andWhere({ agencyId: user.agencyId, lead: leads })
    if (!isAdmin(user.role)) inScopeQ.whereIn('userId', gotPermIds)
    const inScopeRows = await inScopeQ.select('id')
    const inScopeIds: number[] = inScopeRows.map((r: any) => Number(r.id))

    if (inScopeIds.length === 0) return { deleted: 0, skipped: ids.length }

    await hardDeleteSalesForClients(trx, inScopeIds, user.agencyId)

    const deleteQ = trx('clients').whereIn('id', inScopeIds).andWhere({ agencyId: user.agencyId, lead: leads })
    if (!isAdmin(user.role)) deleteQ.whereIn('userId', gotPermIds)
    const deleted = await deleteQ.del()

    return { deleted, skipped: ids.length - deleted }
  })

  if (result.deleted > 0) {
    revalidatePath('/leads')
    revalidatePath('/clients')
  }
  return result
}

export async function upsertLead(userId, data, clientId, revalidate = true) {
  const user = await requireUser()
  const safeData = pickLeadFields(data ?? {})

  try {
    let lead = null

    if (clientId) {
      if (isLeadTrue(safeData.lead)) {
        const existing = await db('clients').where({ id: clientId, agencyId: user.agencyId }).first('lead')
        if (existing && existing.lead === false) {
          await assertLeadQuota(user.agencyId, 1)
        }
      }
      const q = db('clients').where({ id: clientId, agencyId: user.agencyId })
      lead = (await q.update(safeData).returning('*'))[0]
    } else {
      const agencyId = await getAgencyId()
      lead = await withAgencyQuotaLock(agencyId, async (trx) => {
        await assertLeadQuota(agencyId, 1, trx)
        const rows = await trx('clients')
          .insert({ ...safeData, agencyId, createdById: userId })
          .returning('*')
        return rows[0]
      })
    }

    if (revalidate) revalidatePath('/leads')

    return lead
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return {
        error: 'quota_exceeded' as const,
        current: error.current,
        limit: error.limit,
        attempted: error.attempted,
      }
    }
    console.error(error)
    return { err: true, msg: 'שגיאה בשמירת לקוח' }
  }
}

export async function upsertLeadList(userId, data) {
  await requireUser()
  if (data.id) await db('client_lists').where({ id: data.id }).update(data)
  else await db('client_lists').insert({ userId, ...data })

  revalidatePath('/leads')
}

export async function deleteLeadList(id) {
  await requireUser()
  await db('client_lists').where({ id }).delete()

  revalidatePath('/leads')
}

export async function transferDealsToLead(fromClientId, toClientId) {
  const user = await requireUser()
  const from = await db('clients').where({ id: fromClientId, agencyId: user.agencyId }).first()
  if (!from) throw new Error('Forbidden')
  const to = await db('clients').where({ id: toClientId, agencyId: user.agencyId }).first()
  if (!to) throw new Error('Forbidden')
  await db('sales').where('clientId', fromClientId).update({ clientId: toClientId })
  revalidatePath('/leads')
}

export async function transferLeadToRep(clientId, userId) {
  const user = await requireUser()
  await db('clients').where({ id: clientId, agencyId: user.agencyId }).update({ userId })
  revalidatePath('/leads')
}

async function searchBase(val, isLead) {
  const terms = val.split(' ').filter((term) => term)

  const agencyId = await getAgencyId()
  const plan = await getAgencyPlan(agencyId)
  const query = db('clients').select('id', 'details', 'firstName', 'lastName', 'idNum', 'userId').where('agencyId', agencyId)
  if (plan === 'free') query.where('overQuota', false)
  if (isLead === true) {
    query.where('lead', true)
  } else {
    // deals search — include both leads and clients so newly created leads are findable
    query.whereIn('lead', [true, false])
  }

  terms.forEach((term) => {
    query.where((builder) => {
      builder.where('details', 'ilike', `%${term}%`).orWhere(db.raw('"idNum"::text'), 'ilike', `%${term}%`)
    })
  })

  query.orderByRaw(
    `
    CASE
      WHEN "idNum"::text ILIKE ? THEN 1
      WHEN "details" ILIKE ? THEN 2
      WHEN "firstName" ILIKE ? THEN 3
      WHEN "lastName" ILIKE ? THEN 4
      WHEN "idNum"::text ILIKE ? THEN 5
      ELSE 6
    END, "details"
  `,
    [`${val}%`, `${val}%`, `${val}%`, `${val}%`, `%${val}%`],
  )

  const res = await query.limit(50)
  return res
}

export async function searchContacts(val) {
  return searchBase(val, false)
}

export async function searchLeads(val) {
  return searchBase(val, true)
}

export async function getLeadById(clientId) {
  const res = await db('clients')
    .where('id', clientId)
    .first()
    .select('id', 'firstName', 'lastName', 'idNum', 'createdById', 'userId')
  return res
}

export async function updateLead(data) {
  const user = await requireUser()
  const { id } = data ?? {}
  const safeData: Record<string, any> = pickLeadFields(data ?? {})

  if (isLeadTrue(safeData.lead)) {
    const existing = await db('clients').where({ id, agencyId: user.agencyId }).first('lead')
    if (existing && existing.lead === false) {
      await assertLeadQuota(user.agencyId, 1)
    }
  }

  if ('status' in safeData) {
    safeData.statusChangedAt = new Date()
  }
  safeData.updatedAt = new Date()

  const { gotPermIds } = await getPerms(user)
  const query = db('clients').where({ id, agencyId: user.agencyId })
  if (!isAdmin(user.role)) query.whereIn('userId', gotPermIds)
  const res = await query
    .update(safeData)
    .returning('*')
    .catch((err) => {
      console.error('updateLead failed', err)
      throw err
    })

  if (!res || res.length === 0) {
    throw new Error('No rows updated')
  }

  revalidatePath('/leads')
  return res[0]
}

export async function getLeadByIdNum(idNum: string) {
  const agencyId = await getAgencyId()

  const res = await db('clients')
    .where({ idNum: idNum.padStart(9, '0'), agencyId })
    .select('name')
    .first()
  return res
}

export async function uploadLeadData(file) {
  const fileStream = file.stream()
  const chunks = []

  for await (const chunk of fileStream) {
    chunks.push(chunk)
  }

  const rawBuffer = Buffer.concat(chunks)
  const workbook = XLSX.read(rawBuffer, { type: 'buffer' })
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheetName]
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

  let headers = (jsonData[0] as string[]).map((h) => (typeof h === 'string' ? h.trim() : ''))

  const requiredHeaders = ['שם פרטי', 'שם משפחה', 'תעודת זהות']
  const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h))
  if (missingHeaders.length > 0) {
    return { data: [], wrongData: [], error: `העמודות הבאות חסרות בקובץ: ${missingHeaders.join(', ')}` }
  }

  const dataRows = jsonData.slice(1) as any[][]
  const mappedData = []
  const mappedCancelData = []
  for (const row of dataRows) {
    if (row?.length) {
      const rowObject = {} as any
      let isOk = true
      headers.forEach((header, index) => {
        if (!row[index]) return (isOk = false)

        if (header === 'תעודת זהות' && !isIdNumValid(row[index])) isOk = false

        if (header === 'תעודת זהות') return (rowObject.idNum = row[index])
        if (header === 'שם פרטי') return (rowObject.firstName = row[index]?.trim())
        if (header === 'שם משפחה') return (rowObject.lastName = row[index]?.trim())

        isOk = false
      })
      isOk ? mappedData.push(rowObject) : mappedCancelData.push(rowObject)
    }
  }

  return { data: mappedData, wrongData: mappedCancelData }
}

export async function addLeads(leads): Promise<AddLeadsResult> {
  const { id: userId } = await getUser()
  const agencyId = await getAgencyId()
  const safeLeads: any[] = Array.isArray(leads) ? leads.map((lead) => pickLeadFields(lead ?? {})) : []
  const formatLeads: any[] = safeLeads.map((lead) => {
    return {
      handlerId: userId,
      userId,
      lead: true,
      ...lead,
      createdById: userId,
      status: 'new',
      agencyId,
    }
  })

  const existingIdNums = await db('clients')
    .select('idNum')
    .whereIn(
      'idNum',
      formatLeads.map((lead) => lead.idNum),
    )
  const newLeads = formatLeads.filter((lead) => !existingIdNums.some((idNum) => idNum.idNum === lead.idNum))

  if (!newLeads.length) return { success: true, inserted: 0 }

  try {
    await withAgencyQuotaLock(agencyId, async (trx) => {
      await assertLeadQuota(agencyId, newLeads.length, trx)
      await trx('clients').insert(newLeads)
    })
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return {
        error: 'quota_exceeded' as const,
        current: error.current,
        limit: error.limit,
        attempted: leads.length,
        wouldInsert: newLeads.length,
      }
    }
    throw error
  }

  revalidatePath('/leads')
  return { success: true, inserted: newLeads.length }
}

export async function getLeadDeals(clientId) {
  await requireUser()
  const deals = await db('_sales').where('clientId', clientId)
  return deals
}

function parseCSVLine(line: string, delim: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

export async function importLeadsFromCsv(file: File) {
  const user = await requireUser()
  const { id: userId } = await getUser()
  const agencyId = await getAgencyId()
  // ── DEBUG: agency scope trace ──────────────────────────────────────────
  console.log('[importLeadsFromCsv][debug] user.agencyId:', user.agencyId)
  console.log('[importLeadsFromCsv][debug] user.id:', user.id, 'user.email:', user.email)
  console.log('[importLeadsFromCsv][debug] getUser().id:', userId)
  console.log('[importLeadsFromCsv][debug] getAgencyId():', agencyId)
  // ───────────────────────────────────────────────────────────────────────

  const chunks: Buffer[] = []
  for await (const chunk of (file as any).stream()) chunks.push(chunk)
  const buf = Buffer.concat(chunks)
  const nullRatio = buf.subarray(0, 200).filter((b) => b === 0).length / 200
  const text = nullRatio > 0.2 ? buf.toString('utf16le') : buf.toString('utf-8')

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) return { inserted: 0, updated: 0, unchanged: 0, invalid: 0 }

  const delim = lines[0].includes('\t') ? '\t' : ','
  const headers = parseCSVLine(lines[0], delim).map((h) =>
    h
      .toLowerCase()
      .replace(/^["']|["']$/g, '')
      .replace(/_/g, ' '),
  )
  const idx = (keywords: string[]) => headers.findIndex((h) => keywords.some((k) => h.includes(k)))
  const nameIdx = idx(['שם', 'name', 'full name'])
  const phoneIdx = idx(['טלפון', 'נייד', 'phone', 'mobile', 'tel'])
  const emailIdx = idx(['מייל', 'אימייל', 'email', 'mail'])
  // ── DEBUG: CSV header parsing trace ────────────────────────────────────
  console.log('[importLeadsFromCsv][debug] rawHeaderLine:', JSON.stringify(lines[0]))
  console.log('[importLeadsFromCsv][debug] delimiter:', JSON.stringify(delim))
  console.log('[importLeadsFromCsv][debug] headers:', headers)
  console.log('[importLeadsFromCsv][debug] phoneIdx:', phoneIdx, '→', phoneIdx >= 0 ? headers[phoneIdx] : '(not found)')
  console.log('[importLeadsFromCsv][debug] emailIdx:', emailIdx, '→', emailIdx >= 0 ? headers[emailIdx] : '(not found)')
  console.log('[importLeadsFromCsv][debug] nameIdx:', nameIdx, '→', nameIdx >= 0 ? headers[nameIdx] : '(not found)')
  // ───────────────────────────────────────────────────────────────────────
  if (phoneIdx === -1) console.log('[importLeadsFromCsv] headers:', headers)

  const valid: { firstName: string; lastName: string; phone: string | null; email: string | null }[] = []
  let invalid = 0

  for (const line of lines.slice(1)) {
    const cols = parseCSVLine(line, delim).map((c) => c.replace(/^["']|["']$/g, ''))

    const rawPhone = phoneIdx >= 0 ? cols[phoneIdx] : ''
    const rawEmail = emailIdx >= 0 ? cols[emailIdx] : ''
    const rawName = nameIdx >= 0 ? cols[nameIdx] : ''

    if (!rawPhone && !rawEmail) {
      invalid++
      continue
    }

    // normalize phone → 972XXXXXXXXX
    let phone: string | null = null
    if (rawPhone) {
      const digits = rawPhone.replace(/\D/g, '')
      if (digits.length >= 9) {
        phone = digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')
      }
    }

    const email = rawEmail ? rawEmail.toLowerCase() : null

    if (!phone && !email) {
      invalid++
      continue
    }

    const parts = rawName.trim().split(/\s+/)
    valid.push({ firstName: parts[0] || '', lastName: parts.slice(1).join(' '), phone, email })
  }

  let inserted = 0
  let updated = 0
  let unchanged = 0

  for (const lead of valid) {
    try {
      const exists = await db('clients')
        .where({ agencyId })
        .where((q) => {
          if (lead.phone) q.orWhere('phone', lead.phone)
          if (lead.email) q.orWhere('email', lead.email)
        })
        .first()

      if (!exists) {
        const res = await upsertLead(userId, { ...lead, lead: true, status: 'new', userId, handlerId: userId }, null, false)
        if (res && (res as any).error === 'quota_exceeded') {
          if (inserted > 0 || updated > 0) revalidatePath('/leads')
          return {
            error: 'quota_exceeded' as const,
            current: (res as any).current,
            limit: (res as any).limit,
            attempted: valid.length,
            wouldInsert: valid.length - inserted - updated - unchanged,
            inserted,
            updated,
            unchanged,
            invalid,
          }
        }
        inserted++
        continue
      }

      // fill only empty fields — never overwrite existing values
      const patch: Record<string, string> = {}
      if (!exists.firstName && lead.firstName) patch.firstName = lead.firstName
      if (!exists.lastName && lead.lastName) patch.lastName = lead.lastName
      if (!exists.phone && lead.phone) patch.phone = lead.phone
      if (!exists.email && lead.email) patch.email = lead.email

      if (Object.keys(patch).length === 0) {
        unchanged++
      } else {
        await db('clients').where({ id: exists.id }).update(patch)
        updated++
      }
    } catch {
      unchanged++
    }
  }

  if (inserted > 0 || updated > 0) revalidatePath('/leads')
  return { inserted, updated, unchanged, invalid }
}

export async function fetchLeadsSince(lastSeenAt: string) {
  const user = await requireUser()
  const agencyId = user.agencyId
  const plan = await getAgencyPlan(agencyId)
  const query = db('clients')
    .where({ 'clients.agencyId': agencyId, lead: true })
    .whereRaw('"clients"."updatedAt"::timestamptz > ?::timestamptz', [lastSeenAt])
    .leftJoin({ handler: 'users' }, 'clients.handlerId', 'handler.id')
    .leftJoin({ creator: 'users' }, 'clients.userId', 'creator.id')
    .select('clients.*', 'handler.name as handlerName', 'creator.name as userName')
    .orderBy('clients.updatedAt', 'asc')
    .limit(100)
  if (plan === 'free') query.where('clients.overQuota', false)
  if (!isAdmin(user.role)) {
    const { gotPermIds } = await getPerms(user)
    query.whereIn('clients.userId', gotPermIds)
  }
  return query
}
