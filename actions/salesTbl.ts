'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { toIso } from '@/lib/dates'
import { requireUser } from '@/lib/requireUser'

// get deals table data for export, without limit but with filters
export async function getDealDataToExport(sqlExport) {
  const user = await requireUser()

  const sql = (sqlExport.sql || '').trim()
  const upper = sql.toUpperCase()

  if (!upper.startsWith('SELECT')) throw new Error('Invalid export query')
  if (/;/.test(sql)) throw new Error('Invalid export query')
  // Block mutations, cross-table access, and SQL composition patterns
  if (/\b(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|CREATE|EXEC|EXECUTE|UNION|JOIN)\b/.test(upper)) {
    throw new Error('Invalid export query')
  }
  // Block subqueries
  if (/\(\s*SELECT\b/i.test(sql)) throw new Error('Invalid export query')
  // Only _sales is permitted — reject anything else
  if (!/\bFROM\s+"?_sales"?\b/i.test(sql)) throw new Error('Invalid export query')

  // Hard-enforce agency isolation: wrap the inner query and filter by the
  // authenticated user's agencyId regardless of what the inner SQL specifies.
  const res = await db.raw(`SELECT * FROM (${sql}) AS _export WHERE "agencyId" = ?`, [
    ...(sqlExport.bindings || []),
    user.agencyId,
  ])
  return res.rows
}

export async function addFavDeals(dealIds: number[]) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY(SELECT DISTINCT UNNEST("favSaleIds" || ?::integer[]))`, [dealIds]),
    })

  revalidatePath('/deals')
}

export async function removeFavDeals(dealIds: number[]) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY(SELECT UNNEST("favSaleIds") EXCEPT SELECT UNNEST(?::integer[]))`, [dealIds]),
    })

  revalidatePath('/deals')
}

export async function removeFavDeal(dealId: number) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY_REMOVE("favSaleIds", ?::integer)`, dealId),
    })

  revalidatePath('/deals')
}

// מחיקת עסקאות
export async function deleteDeals(ids: number[]) {
  const user = await requireUser()
  const owned = await db('sales').whereIn('id', ids).where({ agencyId: user.agencyId }).select('id')
  if (owned.length !== ids.length) throw new Error('Forbidden')
  const res = await db.raw(`select delete_sales(?, ?)`, [ids, user.id])
  revalidatePath('/deals')
  return res?.rowCount
}

// מחיקת עסקה
export async function deleteDeal(id: number) {
  const user = await requireUser()
  const owned = await db('sales').where({ id, agencyId: user.agencyId }).first()
  if (!owned) throw new Error('Forbidden')
  const res = await db.raw('SELECT delete_sales(?, ?)', [[id], user.id])

  revalidatePath('/deals')
  return res?.rowCount
}

export async function updateDealDt(dealId: number, saleDt: string) {
  const user = await requireUser()
  await db('sales').where({ id: dealId, agencyId: user.agencyId }).update({ saleDt })
  revalidatePath('/deals')
}

// עדכון סטטוס לעסקאות
export async function updateDealStatus(dealId: number, status: string) {
  const user = await requireUser()
  const obj = { status } as any
  if (status === 'הופק') obj.saleDt = toIso(new Date())
  await db('sales').where({ id: dealId, agencyId: user.agencyId }).update(obj)
  revalidatePath('/deals')
}

// עדכון סטטוס לעסקאות
export async function updateManyDealStatus(dealIds: number[], status: string) {
  const user = await requireUser()
  const res = await db('sales').whereIn('id', dealIds).where({ agencyId: user.agencyId }).update({ status })
  revalidatePath('/deals')
  return res
}

export async function saveReward(dealId: number, checked: boolean) {
  const user = await requireUser()
  await db('sales').where({ id: dealId, agencyId: user.agencyId }).update('rwrd', checked)
  revalidatePath('/deals')
}
