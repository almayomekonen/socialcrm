import { db } from '../config/db'

const EMAIL = 'alamayo274@gmail.com'

async function run() {
  const user = await db('users').where({ email: EMAIL }).first()
  if (!user) {
    console.error(`user not found: ${EMAIL}`)
    await db.destroy()
    process.exit(1)
  }
  const agencyId = user.agencyId
  console.log(`user.id=${user.id} agencyId=${agencyId} email=${EMAIL}`)

  const agency = await db('agencies').where({ id: agencyId }).select('id', 'plan', 'planReason').first()
  console.log('agency:', agency)

  const [A, B, C, Dlead, Dall, Dtrue] = await Promise.all([
    db('clients').where({ agencyId, lead: true }).count<{ count: string }>('id as count').first(),
    db('clients').where({ agencyId, lead: true, overQuota: false }).count<{ count: string }>('id as count').first(),
    db('clients').where({ agencyId, lead: true, overQuota: true }).count<{ count: string }>('id as count').first(),
    db('clients').where({ agencyId, lead: false }).count<{ count: string }>('id as count').first(),
    db('clients').where({ agencyId }).count<{ count: string }>('id as count').first(),
    db('clients').where({ agencyId, overQuota: false }).count<{ count: string }>('id as count').first(),
  ])

  console.log('A  total leads           (lead=true):                  ', A?.count)
  console.log('B  quota-visible leads   (lead=true, overQuota=false): ', B?.count)
  console.log('C  over-quota leads      (lead=true, overQuota=true):  ', C?.count)
  console.log('   non-lead clients      (lead=false):                 ', Dlead?.count)
  console.log('   ALL rows in clients   (any lead, any overQuota):    ', Dall?.count)
  console.log('   pre-fix quota count   (overQuota=false, any lead):  ', Dtrue?.count)

  const recent = await db('clients')
    .where({ agencyId })
    .orderBy('createdAt', 'desc')
    .limit(30)
    .select('id', 'lead', 'overQuota', 'createdAt', 'updatedAt', 'leadSource', 'status')
  console.log('\nrecent 30 rows:')
  for (const r of recent) {
    console.log(
      `  id=${r.id}  lead=${r.lead}  overQuota=${r.overQuota}  status=${r.status}  leadSource=${r.leadSource ?? ''}  createdAt=${r.createdAt?.toISOString?.() ?? r.createdAt}`,
    )
  }

  const overSample = await db('clients')
    .where({ agencyId, overQuota: true })
    .orderBy('createdAt', 'desc')
    .limit(10)
    .select('id', 'lead', 'overQuota', 'createdAt', 'leadSource', 'status')
  console.log('\nover-quota sample (up to 10):')
  for (const r of overSample) {
    console.log(
      `  id=${r.id}  lead=${r.lead}  overQuota=${r.overQuota}  status=${r.status}  leadSource=${r.leadSource ?? ''}  createdAt=${r.createdAt?.toISOString?.() ?? r.createdAt}`,
    )
  }

  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
