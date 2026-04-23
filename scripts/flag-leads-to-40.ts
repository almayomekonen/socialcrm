import { db } from '../config/db'

const AGENCY_ID = 1
const TARGET = 40

async function run() {
  const before = {
    active: Number(
      (await db('clients').where({ agencyId: AGENCY_ID, lead: true, overQuota: false }).count<{ count: string }>('id as count').first())?.count ?? 0,
    ),
    over: Number(
      (await db('clients').where({ agencyId: AGENCY_ID, lead: true, overQuota: true }).count<{ count: string }>('id as count').first())?.count ?? 0,
    ),
    total: Number(
      (await db('clients').where({ agencyId: AGENCY_ID, lead: true }).count<{ count: string }>('id as count').first())?.count ?? 0,
    ),
  }
  console.log(`before: active=${before.active}  overQuota=${before.over}  totalLeads=${before.total}  agencyId=${AGENCY_ID}`)

  let flagged = 0

  await db.transaction(async (trx) => {
    const activeRow = await trx('clients')
      .where({ agencyId: AGENCY_ID, lead: true, overQuota: false })
      .count<{ count: string }>('id as count')
      .first()
    const active = Number(activeRow?.count ?? 0)

    if (active <= TARGET) {
      console.log(`no flagging needed — active (${active}) ≤ target (${TARGET})`)
      return
    }

    const need = active - TARGET
    const oldest = await trx('clients')
      .where({ agencyId: AGENCY_ID, lead: true, overQuota: false })
      .orderBy('createdAt', 'asc')
      .limit(need)
      .select('id')
    const ids: number[] = oldest.map((r: any) => Number(r.id))

    if (ids.length !== need) {
      throw new Error(`expected to pick ${need} rows, got ${ids.length}`)
    }

    flagged = await trx('clients').whereIn('id', ids).update({ overQuota: true })
    if (flagged !== need) {
      throw new Error(`expected to flag ${need} rows, updated ${flagged}`)
    }
  })

  const after = {
    active: Number(
      (await db('clients').where({ agencyId: AGENCY_ID, lead: true, overQuota: false }).count<{ count: string }>('id as count').first())?.count ?? 0,
    ),
    over: Number(
      (await db('clients').where({ agencyId: AGENCY_ID, lead: true, overQuota: true }).count<{ count: string }>('id as count').first())?.count ?? 0,
    ),
    total: Number(
      (await db('clients').where({ agencyId: AGENCY_ID, lead: true }).count<{ count: string }>('id as count').first())?.count ?? 0,
    ),
  }

  console.log(`after : active=${after.active}  overQuota=${after.over}  totalLeads=${after.total}`)
  console.log('')
  console.log(`agencyId             : ${AGENCY_ID}`)
  console.log(`active before        : ${before.active}`)
  console.log(`rows flagged         : ${flagged}`)
  console.log(`active after         : ${after.active}`)
  console.log(`overQuota after      : ${after.over}`)
  console.log(`total leads preserved: ${after.total === before.total ? 'OK' : 'MISMATCH'}  (before=${before.total}, after=${after.total})`)
  console.log(`target (active = 40) : ${after.active === TARGET ? 'OK' : 'MISMATCH'}`)

  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
