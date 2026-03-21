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

export async function updateLead(data) {
  await requireUser()
  const res = await db('clients')
    .where({ id: data.id })
    .update(data)
    .catch(() => null)

  revalidatePath('/settings/self_edit')
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
