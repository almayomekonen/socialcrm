/**
 * Concurrency verification for the agency quota lock.
 *
 * Scenario: 49 visible leads already in an isolated test agency on the free
 * plan (limit = 50). We fire 5 simultaneous inserts that each follow the same
 * "acquire lock → assertLeadQuota → insert" pattern used by upsertLead.
 *
 * Expected outcome under the lock:
 *   - Exactly 1 insert succeeds (count goes 49 → 50).
 *   - The other 4 fail with QuotaExceededError.
 *
 * Without the lock this would regularly produce 5 successes (count goes to
 * 54) because every request would read "49" before any commit.
 *
 * Run with: `npm run mig verify-quota-race.ts`
 */
import { db } from '@/config/db'
import { assertLeadQuota, QuotaExceededError, withAgencyQuotaLock, FREE_LEAD_LIMIT } from '@/lib/quota'

const AGENCY_NAME = `__quota_race_test__${Date.now()}`
const SEED = 49
const PARALLEL = 5

async function main() {
  console.log(`=== Quota race verification (free limit = ${FREE_LEAD_LIMIT}) ===`)

  // 1. Isolated agency + user
  const [agency] = await db('agencies').insert({ name: AGENCY_NAME, plan: 'free' }).returning('id')
  const agencyId = Number(agency.id)
  const [user] = await db('users').insert({ firstName: '__race__', lastName: 'user', role: 'ADMIN', agencyId }).returning('id')
  const userId = Number(user.id)

  console.log(`Seeded agency=${agencyId}, user=${userId}`)

  try {
    // 2. Seed 49 visible leads
    // BEFORE-INSERT trigger `add_zeros_to_idnum` LPADs idNum to 9 chars, so
    // feed it 9-char numeric values that are unique per (agencyId). This
    // agency is brand new, so simple counters work.
    const rows = Array.from({ length: SEED }, (_, i) => ({
      firstName: '__race__',
      lastName: `lead_${i}`,
      idNum: String(100000 + i).padStart(9, '0'),
      agencyId,
      userId,
      createdById: userId,
      handlerId: userId,
      lead: true,
      status: 'new',
      overQuota: false,
    }))
    await db('clients').insert(rows)
    const seeded = await db('clients')
      .where({ agencyId, lead: true, overQuota: false })
      .count<{ count: string }>('id as count')
      .first()
    console.log(`Seeded leads: ${seeded?.count} (target: ${SEED})`)

    // 3. Fire PARALLEL inserts simultaneously through the lock
    const tasks = Array.from({ length: PARALLEL }, (_, i) =>
      withAgencyQuotaLock(agencyId, async (trx) => {
        await assertLeadQuota(agencyId, 1, trx)
        const [inserted] = await trx('clients')
          .insert({
            firstName: '__race__',
            lastName: `attempt_${i}`,
            idNum: String(900000 + i).padStart(9, '0'),
            agencyId,
            userId,
            createdById: userId,
            handlerId: userId,
            lead: true,
            status: 'new',
            overQuota: false,
          })
          .returning('id')
        return { i, id: Number(inserted.id) }
      }).then(
        (res) => ({ kind: 'ok' as const, ...res }),
        (err: any) => ({
          kind: err instanceof QuotaExceededError ? ('quota' as const) : ('error' as const),
          i,
          err,
        }),
      ),
    )

    const results = await Promise.all(tasks)

    const successes = results.filter((r) => r.kind === 'ok')
    const quotaErrors = results.filter((r) => r.kind === 'quota')
    const otherErrors = results.filter((r) => r.kind === 'error')

    console.log('\n--- Results ---')
    console.log(`successes:    ${successes.length}`)
    console.log(`quota fails:  ${quotaErrors.length}`)
    console.log(`other errors: ${otherErrors.length}`)
    if (otherErrors.length) {
      for (const r of otherErrors) console.error('  unexpected:', (r as any).err)
    }

    const final = await db('clients')
      .where({ agencyId, lead: true, overQuota: false })
      .count<{ count: string }>('id as count')
      .first()
    console.log(`final visible count: ${final?.count}`)

    const pass = successes.length === 1 && quotaErrors.length === PARALLEL - 1 && Number(final?.count) === SEED + 1
    console.log(pass ? '\nPASS: exactly 1 succeeded, quota held under contention' : '\nFAIL: contention broke the quota')
    process.exitCode = pass ? 0 : 1
  } finally {
    // 4. Teardown — always clean up
    await db('clients').where({ agencyId }).delete()
    await db('users').where({ agencyId }).delete()
    await db('agencies').where({ id: agencyId }).delete()
    await db.destroy()
  }
}

main().catch(async (err) => {
  console.error(err)
  try {
    await db.destroy()
  } catch {}
  process.exit(1)
})
