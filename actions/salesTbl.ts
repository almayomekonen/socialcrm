'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { toIso } from '@/lib/dates'

// get deals table data for export, without limit but with filters
export async function getDealDataToExport(sqlExport) {
  const sql = (sqlExport.sql || '').trim()
  const upper = sql.toUpperCase()

  if (!upper.startsWith('SELECT')) throw new Error('Only SELECT queries are allowed')
  if (/;/.test(sql)) throw new Error('Invalid query: multiple statements not allowed')
  if (/\b(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|CREATE|EXEC|EXECUTE)\b/.test(upper)) {
    throw new Error('Invalid query: forbidden keywords detected')
  }

  const res = await db.raw(sql, sqlExport.bindings)
  return res.rows
}

export async function addFavDeals(dealIds: number[]) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY(SELECT DISTINCT UNNEST("favSaleIds" || ?::integer[]))`, [dealIds]),
    })

  revalidatePath('/')
}

export async function removeFavDeals(dealIds: number[]) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY(SELECT UNNEST("favSaleIds") EXCEPT SELECT UNNEST(?::integer[]))`, [dealIds]),
    })

  revalidatePath('/')
}

export async function removeFavDeal(dealId: number) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY_REMOVE("favSaleIds", ?::integer)`, dealId),
    })

  revalidatePath('/')
}

// מחיקת עסקאות
export async function deleteDeals(ids: number[]) {
  const deletedById = (await getUser())?.id
  const res = await db.raw(`select delete_sales(?, ?)`, [ids, deletedById])
  revalidatePath('/')
  return res?.rowCount
}

// מחיקת עסקה
export async function deleteDeal(id: number) {
  const deletedById = (await getUser())?.id
  const res = await db.raw('SELECT delete_sales(?, ?)', [[id], deletedById])

  revalidatePath('/')
  return res?.rowCount
}

export async function updateDealDt(dealId: number, saleDt: string) {
  await db('sales').where({ id: dealId }).update({ saleDt })
  revalidatePath('/')
}

// עדכון סטטוס לעסקאות
export async function updateDealStatus(dealId: number, status: string) {
  const obj = { status } as any
  if (status === 'הופק') obj.saleDt = toIso(new Date())
  await db('sales').where({ id: dealId }).update(obj)
}

// עדכון סטטוס לעסקאות
export async function updateManyDealStatus(dealIds: number[], status: string) {
  const res = await db('sales').whereIn('id', dealIds).update({ status })
  revalidatePath('/')
  return res
}

export async function saveReward(dealId: number, checked: boolean) {
  await db('sales').where({ id: dealId }).update('rwrd', checked)
}
