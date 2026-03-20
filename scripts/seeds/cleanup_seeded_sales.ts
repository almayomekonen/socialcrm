import { db } from '@/config/db'

const SEEDED_BY = [208, 219, 234, 114, 72, 86]

async function cleanup() {
  const saleIds = await db('sales').whereIn('createdById', SEEDED_BY).where('agencyId', 1).pluck('id')

  if (saleIds.length === 0) {
    console.log('Nothing to delete.')
    await db.destroy()
    return
  }

  await db('sale_users').whereIn('saleId', saleIds).delete()
  await db('sales').whereIn('id', saleIds).delete()

  console.log(`✅ Deleted ${saleIds.length} seeded sales and their sale_users.`)
  await db.destroy()
}

cleanup()
