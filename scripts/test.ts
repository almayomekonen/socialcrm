import { db } from '@/config/db'

async function run() {
  const sales = await db('sales').where('id', 1)
  console.log(sales)

  console.log('done')
  db.destroy()
}

run()
