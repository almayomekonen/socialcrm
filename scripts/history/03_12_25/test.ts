import { db } from '@/config/db'

async function run() {
  console.log('Checking for invalid sales shares...')

  const invalidSales = await db('sale_users')
    .select('saleId')
    .sum('prcnt as totalShare')
    .count('userId as userCount')
    .groupBy('saleId')
    .havingRaw('sum(prcnt) > 100')
    .havingRaw('count("userId") > 1')

  if (invalidSales.length > 0) {
    console.log(`Found ${invalidSales.length} sales with invalid shares:`)
    console.table(invalidSales)

    const saleIds = invalidSales.map((s) => s.saleId).slice(0, 5)
    if (saleIds.length > 0) {
      console.log('Details for first few invalid sales:')
      const details = await db('sale_users')
        .join('users', 'sale_users.userId', 'users.id')
        .whereIn('saleId', saleIds)
        .select('saleId', 'users.name', 'prcnt')
        .orderBy('saleId')
      console.table(details)
    }
  } else {
    console.log('No invalid sales found.')
  }

  console.log('Done')
  db.destroy()
}

run()
