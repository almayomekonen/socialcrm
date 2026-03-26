'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { revalidatePath } from 'next/cache'
import { isIdNumValid } from '@/lib/funcs'
import * as XLSX from 'xlsx'
import { requireUser } from '@/lib/requireUser'

export async function deleteLead(clientId) {
  await requireUser()
  const res = await db('sales').where('clientId', clientId).first()
  if (res) {
    throw new Error('לא ניתן למחוק לקוח עם מכירות')
  }

  await db('clients').where('id', clientId).del()

  revalidatePath('/clients')
}

export async function upsertLead(userId, data, clientId, revalidate = true) {
  if (!data._system) await requireUser()
  const isSystem = data._system
  delete data._system
  try {
    let lead = null

    if (clientId) {
      lead = (await db('clients').where({ id: clientId }).update(data).returning('*'))[0]
    } else {
      if (!isSystem) data.agencyId = await getAgencyId()
      data.createdById = userId
      lead = (await db('clients').insert(data).returning('*'))[0]
    }

    if (revalidate) revalidatePath('/clients')

    return lead
  } catch (error) {
    console.error(error)
    return { err: true, msg: 'שגיאה בשמירת לקוח' }
  }
}

export async function upsertLeadList(userId, data) {
  await requireUser()
  if (data.id) await db('client_lists').where({ id: data.id }).update(data)
  else await db('client_lists').insert({ userId, ...data })

  revalidatePath('/clients')
}

export async function deleteLeadList(id) {
  await requireUser()
  await db('client_lists').where({ id }).delete()

  revalidatePath('/clients')
}

export async function transferDealsToLead(fromClientId, toClientId) {
  await requireUser()
  await db('sales').where('clientId', fromClientId).update({ clientId: toClientId })
  revalidatePath('/clients')
}

export async function transferLeadToRep(clientId, userId) {
  await requireUser()
  await db('clients').where('id', clientId).update({ userId })
  revalidatePath('/clients')
}

async function searchBase(val, isLead) {
  const terms = val.split(' ').filter((term) => term)

  const query = db('clients')
    .select('id', 'details', 'firstName', 'lastName', 'idNum', 'userId')
    .where('agencyId', await getAgencyId())
  query.where('lead', isLead)

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

export async function recordActivity(leadId: number) {
  await requireUser()
  await db('clients').where('id', leadId).update({ lastActivityAt: new Date() })
}

export async function recordOutcome(leadId: number, outcome: 'talked' | 'no-answer' | 'snooze') {
  await requireUser()
  const agencyId = await getAgencyId()

  const before = await db('clients').where('id', leadId).select('id', 'rank', 'userId', 'agencyId').first()
  console.log('BEFORE:', before)

  const now = new Date()
  await db('clients').where('id', leadId).update({ lastActivityAt: now, lastOutcomeType: outcome, updatedAt: now })

  const after = await db('clients').where('id', leadId).select('id', 'rank', 'userId', 'agencyId').first()
  console.log('AFTER:', after)

  const inPipeline = await db('clients')
    .where('id', leadId)
    .where('agencyId', agencyId)
    .where(function () {
      this.where('rank', '<=', 4).orWhereNull('rank')
    })
    .first()
  console.log('IN PIPELINE:', !!inPipeline)

  revalidatePath('/')
}

export async function updateLead(data) {
  await requireUser()
  const { id, ...rest } = data
  const res = await db('clients').where({ id }).update(rest)
  revalidatePath('/')
  return res
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

  let headers = jsonData[0] as string[]
  headers = headers.map((header) => header.trim())

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

export async function addLeads(leads) {
  const { id: userId } = await getUser()
  const agencyId = await getAgencyId()
  const formatLeads = leads.map((lead) => {
    return {
      createdById: userId,
      handlerId: userId,
      userId,
      ...lead,
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

  await db('clients').insert(newLeads)
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
  await requireUser()
  const { id: userId } = await getUser()
  const agencyId = await getAgencyId()

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
        await upsertLead(userId, { ...lead, lead: true, userId, handlerId: userId }, null, false)
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

export async function fetchLeadsSince(sinceId: number) {
  const agencyId = await getAgencyId()
  return db('clients')
    .where('clients.agencyId', agencyId)
    .where('clients.id', '>', sinceId)
    .where(function () {
      this.where('rank', '<=', 4).orWhereNull('rank')
    })
    .leftJoin({ handler: 'users' }, 'clients.handlerId', 'handler.id')
    .leftJoin({ creator: 'users' }, 'clients.userId', 'creator.id')
    .select('clients.*', 'handler.name as handlerName', 'creator.name as userName')
    .orderBy('clients.id', 'desc')
}
