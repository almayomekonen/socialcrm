import { db } from '@/config/db'

async function check() {
  const r = await db('sales').count('id as c').first()
  console.log('total sales:', r?.c)

  const recent = await db('sales').orderBy('createdAt', 'desc').limit(10).select('id', 'createdAt', 'prdct', 'status', 'agencyId')
  console.log('recent:', JSON.stringify(recent, null, 2))

  const clients = await db('clients').where('agencyId', 1).count('id as c').first()
  console.log('clients in agency 1:', clients?.c)

  await db.destroy()
}

check()
