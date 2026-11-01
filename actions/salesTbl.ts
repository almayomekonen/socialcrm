'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { toIso } from '@/lib/dates'
import { requireBasicCrmAccess, requireProductAccess } from '@/lib/requireUser'
import { getPermsAndFilter } from '@/db/filter'
import { getDealExportRows } from '@/db/salesTbl'
import { parseExportFilter } from '@/lib/deals/exportFilter'

// Export the deals table without a row limit. The client sends only the page's
// active filter; the query is rebuilt here exactly as the page builds it, with
// agency, role and rep permissions taken from the session. No token, no
// client-carried SQL, no dependency on the session signing key.
export async function getDealDataToExport(filter: unknown) {
  const user = await requireProductAccess()

  const parsed = parseExportFilter(filter)
  if (!parsed.ok) throw new Error('Invalid export request')

  const { sqlFilter } = await getPermsAndFilter({ user, filter: parsed.filter })
  return getDealExportRows(sqlFilter, user.agencyId)
}

/**
 * TIER 1. A favourite is a per-user marker on the user's own row, used to sort
 * their own view. No quota, no provider, no commission field.
 */
export async function addFavDeals(dealIds: number[]) {
  await requireBasicCrmAccess()
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY(SELECT DISTINCT UNNEST("favSaleIds" || ?::integer[]))`, [dealIds]),
    })

  revalidatePath('/deals')
}

/**
 * TIER 1. A favourite is a per-user marker on the user's own row, used to sort
 * their own view. No quota, no provider, no commission field.
 */
export async function removeFavDeals(dealIds: number[]) {
  await requireBasicCrmAccess()
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      favSaleIds: db.raw(`ARRAY(SELECT UNNEST("favSaleIds") EXCEPT SELECT UNNEST(?::integer[]))`, [dealIds]),
    })

  revalidatePath('/deals')
}

/** Same per-user marker as the plural pair above, on the single-deal path. */
export async function removeFavDeal(dealId: number) {
  await requireBasicCrmAccess()
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
  const user = await requireProductAccess()
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
  const user = await requireProductAccess()
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
  const user = await requireProductAccess()
  const owned = await db('sales').where({ id, agencyId: user.agencyId }).first()
  if (!owned) throw new Error('Forbidden')
  const deleted = await hardDeleteSales([id], user.agencyId)

  revalidatePath('/deals')
  revalidatePath('/sum_sales')
  return deleted
}

export async function updateDealDt(dealId: number, saleDt: string) {
  const user = await requireProductAccess()
  await db('sales').where({ id: dealId, agencyId: user.agencyId }).update({ saleDt })
  revalidatePath('/deals')
  revalidatePath('/sum_sales')
}

// עדכון סטטוס לעסקאות
/**
 * TIER 1. Moving an existing deal between statuses is CRM bookkeeping on a row
 * the agency already owns. It spends nothing, reaches nothing external, and
 * writes no commission field, so a lapsed subscription does not block it.
 *
 * Authentication, agency scoping and the surrounding permission checks are
 * untouched: every query below still filters on the session's agencyId, and
 * commission and transfer logic is not read or written here.
 */
export async function updateDealStatus(dealId: number, status: string) {
  const user = await requireBasicCrmAccess()
  const obj = { status } as any
  if (status === 'הופק') obj.saleDt = toIso(new Date())
  await db('sales').where({ id: dealId, agencyId: user.agencyId }).update(obj)
  revalidatePath('/deals')
  revalidatePath('/sum_sales')
}

// עדכון סטטוס לעסקאות
/**
 * TIER 1. Moving an existing deal between statuses is CRM bookkeeping on a row
 * the agency already owns. It spends nothing, reaches nothing external, and
 * writes no commission field, so a lapsed subscription does not block it.
 *
 * Authentication, agency scoping and the surrounding permission checks are
 * untouched: every query below still filters on the session's agencyId, and
 * commission and transfer logic is not read or written here.
 */
export async function updateManyDealStatus(dealIds: number[], status: string) {
  const user = await requireBasicCrmAccess()
  const res = await db('sales').whereIn('id', dealIds).where({ agencyId: user.agencyId }).update({ status })
  revalidatePath('/deals')
  revalidatePath('/sum_sales')
  return res
}

export async function saveReward(dealId: number, checked: boolean) {
  const user = await requireProductAccess()
  await db('sales').where({ id: dealId, agencyId: user.agencyId }).update('rwrd', checked)
  revalidatePath('/deals')
}
