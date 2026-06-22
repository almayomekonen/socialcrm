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

async function hardDeleteSales(saleIds: number[], agencyId: number): Promise<number> {
  if (saleIds.length === 0) return 0
  return db.transaction(async (trx): Promise<number> => {
    const ownedRows = await trx('sales').whereIn('id', saleIds).andWhere({ agencyId }).select('id')
    const ownedIds: number[] = ownedRows.map((r: any) => Number(r.id))
    if (ownedIds.length === 0) return 0

    await trx('sale_users').whereIn('saleId', ownedIds).del()

    await trx('users')
      .whereRaw('"favSaleIds" && ?::integer[]', [ownedIds])
      .update({
        favSaleIds: trx.raw(`ARRAY(SELECT UNNEST("favSaleIds") EXCEPT SELECT UNNEST(?::integer[]))`, [ownedIds]),
      })

    const deleted = await trx('sales').whereIn('id', ownedIds).del()
    return Number(deleted)
  })
}

// מחיקת עסקאות
export async function deleteDeals(ids: number[]) {
  const user = await requireUser()
  const owned = await db('sales').whereIn('id', ids).where({ agencyId: user.agencyId }).select('id')
  if (owned.length !== ids.length) throw new Error('Forbidden')
  const deleted = await hardDeleteSales(
    owned.map((r: any) => Number(r.id)),
    user.agencyId,
  )
  revalidatePath('/deals')
  revalidatePath('/sum_sales')
  return deleted
}

export type DeleteManyDealsResult = { deleted: number; skipped: number }

export async function deleteManyDeals(ids: number[]): Promise<DeleteManyDealsResult> {
  const user = await requireUser()
  if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0, skipped: 0 }

  const owned = await db('sales').whereIn('id', ids).where({ agencyId: user.agencyId }).select('id')
  const ownedIds: number[] = owned.map((r: any) => Number(r.id))
  if (ownedIds.length === 0) return { deleted: 0, skipped: ids.length }

  const deleted = await hardDeleteSales(ownedIds, user.agencyId)
  revalidatePath('/deals')
  revalidatePath('/sum_sales')
  return { deleted, skipped: ids.length - deleted }
}

// מחיקת עסקה
export async function deleteDeal(id: number) {
  const user = await requireUser()
  const owned = await db('sales').where({ id, agencyId: user.agencyId }).first()
  if (!owned) throw new Error('Forbidden')
  const deleted = await hardDeleteSales([id], user.agencyId)

  revalidatePath('/deals')
  revalidatePath('/sum_sales')
  return deleted
}

export async function updateDealDt(dealId: number, saleDt: string) {
  const user = await requireUser()
  await db('sales').where({ id: dealId, agencyId: user.agencyId }).update({ saleDt })
  revalidatePath('/deals')
  revalidatePath('/sum_sales')
}

// עדכון סטטוס לעסקאות
export async function updateDealStatus(dealId: number, status: string) {
  const user = await requireUser()
  const obj = { status } as any
  if (status === 'הופק') obj.saleDt = toIso(new Date())
  await db('sales').where({ id: dealId, agencyId: user.agencyId }).update(obj)
  revalidatePath('/deals')
  revalidatePath('/sum_sales')
}

// עדכון סטטוס לעסקאות
export async function updateManyDealStatus(dealIds: number[], status: string) {
  const user = await requireUser()
  const res = await db('sales').whereIn('id', dealIds).where({ agencyId: user.agencyId }).update({ status })
  revalidatePath('/deals')
  revalidatePath('/sum_sales')
  return res
}

export async function saveReward(dealId: number, checked: boolean) {
  const user = await requireUser()
  await db('sales').where({ id: dealId, agencyId: user.agencyId }).update('rwrd', checked)
  revalidatePath('/deals')
}
