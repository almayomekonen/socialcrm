import { db } from '../config/db'

const EMAIL = 'alamayo274@gmail.com'
const TARGET = 40

async function countLeads(agencyId: number) {
  const row = await db('clients').where({ agencyId, lead: true }).count<{ count: string }>('id as count').first()
  return Number(row?.count ?? 0)
}

async function run() {
  const user = await db('users').where({ email: EMAIL }).first()
  if (!user) {
    console.error(`user not found: ${EMAIL}`)
    await db.destroy()
    process.exit(1)
  }
  const agencyId: number = user.agencyId
  console.log(`user.id=${user.id} agencyId=${agencyId} email=${EMAIL}`)

  const before = await countLeads(agencyId)
  console.log(`leads before: ${before}`)

  let totalDeleted = 0

  await db.transaction(async (trx) => {
    // Step 1 — delete seed/test leads first, but skip any that own sales (FK safety).
    const seedRows = await trx('clients')
      .where({ agencyId, lead: true })
      .whereLike('leadSource', 'seed:test:%')
      .select('id')
    const seedIds: number[] = seedRows.map((r: any) => Number(r.id))

    let seedDeletable: number[] = []
    let seedBlockedBySales = 0
    if (seedIds.length > 0) {
      const withSales = await trx('sales').whereIn('clientId', seedIds).distinct('clientId')
      const withSalesSet = new Set<number>(withSales.map((r: any) => Number(r.clientId)))
      seedDeletable = seedIds.filter((id) => !withSalesSet.has(id))
      seedBlockedBySales = withSalesSet.size
    }

    let seedDeleted = 0
    if (seedDeletable.length > 0) {
      seedDeleted = await trx('clients').whereIn('id', seedDeletable).del()
    }
    totalDeleted += seedDeleted
    console.log(`step1 — seed:test leads: matched=${seedIds.length}, deleted=${seedDeleted}, blockedBySales=${seedBlockedBySales}`)

    // Step 2 — if still above TARGET, delete the oldest remaining leads (skipping any with sales).
    const afterStep1 = await trx('clients').where({ agencyId, lead: true }).count<{ count: string }>('id as count').first()
    const afterStep1Count = Number(afterStep1?.count ?? 0)
    console.log(`after step1 count: ${afterStep1Count}`)

    if (afterStep1Count > TARGET) {
      const need = afterStep1Count - TARGET
      // Pull oldest leads first; filter out ones with sales; take exactly `need`.
      const candidates = await trx('clients')
        .where({ agencyId, lead: true })
        .orderBy('createdAt', 'asc')
        .select('id')
      const candidateIds: number[] = candidates.map((r: any) => Number(r.id))

      const withSales = await trx('sales').whereIn('clientId', candidateIds).distinct('clientId')
      const withSalesSet = new Set<number>(withSales.map((r: any) => Number(r.clientId)))

      const deletable: number[] = []
      for (const id of candidateIds) {
        if (deletable.length >= need) break
        if (!withSalesSet.has(id)) deletable.push(id)
      }

      const oldestDeleted = deletable.length > 0 ? await trx('clients').whereIn('id', deletable).del() : 0
      totalDeleted += oldestDeleted
      console.log(`step2 — oldest leads: needed=${need}, deletable=${deletable.length}, blockedBySales=${withSalesSet.size}, deleted=${oldestDeleted}`)
    } else {
      console.log('step2 — skipped (already at or below target)')
    }
  })

  const after = await countLeads(agencyId)
  console.log('')
  console.log(`agencyId        : ${agencyId}`)
  console.log(`count before    : ${before}`)
  console.log(`total deleted   : ${totalDeleted}`)
  console.log(`count after     : ${after}`)
  console.log(`target (40)     : ${after === TARGET ? 'OK' : 'MISMATCH'}`)

  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
