'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { toIso } from '@/lib/dates'

// get sales table data for export, without limit but with filters
export async function getSaleDataToExport(sqlExport) {
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

export async function addFavSales(saleIds: number[]) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY(SELECT DISTINCT UNNEST("favSaleIds" || ?::integer[]))`, [saleIds]),
    })

  revalidatePath('/')
}

export async function removeFavSales(saleIds: number[]) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY(SELECT UNNEST("favSaleIds") EXCEPT SELECT UNNEST(?::integer[]))`, [saleIds]),
    })

  revalidatePath('/')
}

export async function removeFavSale(saleId: number) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY_REMOVE("favSaleIds", ?::integer)`, saleId),
    })

  revalidatePath('/')
}

// מחיקת מכירות
export async function deleteSales(ids: number[]) {
  const deletedById = (await getUser())?.id
  const res = await db.raw(`select delete_sales(?, ?)`, [ids, deletedById])
  revalidatePath('/')
  return res?.rowCount
}

// מחיקת מכירות
export async function deleteSale(id: number) {
  const deletedById = (await getUser())?.id
  const res = await db.raw('SELECT delete_sales(?, ?)', [[id], deletedById])

  revalidatePath('/')
  return res?.rowCount
}

export async function updateSaleDt(saleId: number, saleDt: string) {
  await db('sales').where({ id: saleId }).update({ saleDt })
  revalidatePath('/')
}

// עדכון סטטוס למכירות
export async function updateSaleStatus(saleId: number, status: string) {
  const obj = { status } as any
  if (status === 'הופק') obj.saleDt = toIso(new Date())
  await db('sales').where({ id: saleId }).update(obj)
}

// עדכון סטטוס למכירות
export async function updateManySaleStatus(saleIds: number[], status: string) {
  const res = await db('sales').whereIn('id', saleIds).update({ status })
  revalidatePath('/')
  return res
}

export async function saveReward(saleId: number, checked: boolean) {
  await db('sales').where({ id: saleId }).update({ rwrd: checked })
}
