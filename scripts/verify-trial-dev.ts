/**
 * Dev-DB verification for the trial system (Task 4 substitute for vitest
 * integration tests — the test DB cannot be rebuilt from the migration chain;
 * see plan risk table). Exercises the REAL production functions in db/trial.ts
 * against the dev database, then deletes everything it created.
 *
 * Run: npm run mig verify-trial-dev.ts
 * Exit code 0 = all assertions passed and cleanup verified.
 */
import { db } from '../config/db'
import { getAgencyTrial, startTrialForAgency, recordWelcomeModalSeen } from '../db/trial'
import { getTrialState } from '../lib/trial'

const TAG = '__trial_verify_' + Date.now() + '_'
const created: number[] = []
let failures = 0

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}`, detail ?? '')
  }
}

async function seedAgency(opts: {
  plan?: 'free' | 'pro'
  trialExempt?: boolean
  trialStartedAt?: Date | null
  trialEndsAt?: Date | null
}): Promise<number> {
  const [row] = await db('agencies')
    .insert({
      name: TAG + Math.random().toString(36).slice(2),
      plan: opts.plan ?? 'free',
      trialExempt: opts.trialExempt ?? false,
      trialStartedAt: opts.trialStartedAt ?? null,
      trialEndsAt: opts.trialEndsAt ?? null,
    })
    .returning('id')
  const id = typeof row === 'number' ? row : row.id
  created.push(id)
  return id
}

async function eventsFor(agencyId: number): Promise<string[]> {
  const rows = await db('analytics_events').where({ agencyId }).orderBy('id').select('event')
  return rows.map((r) => r.event)
}

async function main() {
  const h = 3_600_000

  console.log('\n[1] startTrialForAgency — happy path + idempotency')
  {
    const id = await seedAgency({})
    const first = await startTrialForAgency(id)
    check('first call starts the trial', first.started === true)
    const row = await db('agencies').where({ id }).first()
    check('trialStartedAt set', row.trialStartedAt != null)
    const lengthMs = new Date(row.trialEndsAt).getTime() - new Date(row.trialStartedAt).getTime()
    check('trial is exactly 7 days (168h)', lengthMs === 7 * 24 * h, lengthMs)
    const second = await startTrialForAgency(id)
    check('second call is a no-op', second.started === false)
    const events = await eventsFor(id)
    check('exactly one trial_started event', JSON.stringify(events) === JSON.stringify(['trial_started']), events)
  }

  console.log('\n[2] guard: trialExempt = true (legacy) — activation impossible')
  {
    const id = await seedAgency({ trialExempt: true })
    const res = await startTrialForAgency(id)
    check('started = false', res.started === false)
    const row = await db('agencies').where({ id }).first()
    check('timestamps stay NULL', row.trialStartedAt === null && row.trialEndsAt === null)
    check('zero analytics events', (await eventsFor(id)).length === 0)
  }

  console.log("\n[3] guard: plan = 'pro' (paid) — activation impossible")
  {
    const id = await seedAgency({ plan: 'pro' })
    const res = await startTrialForAgency(id)
    check('started = false', res.started === false)
    const row = await db('agencies').where({ id }).first()
    check('timestamps stay NULL', row.trialStartedAt === null && row.trialEndsAt === null)
    check('zero analytics events', (await eventsFor(id)).length === 0)
  }

  console.log('\n[4] recordWelcomeModalSeen — dedupe + funnel order')
  {
    const id = await seedAgency({})
    await recordWelcomeModalSeen(id)
    await recordWelcomeModalSeen(id) // second call must add nothing
    const events = await eventsFor(id)
    check(
      'exactly desktop_first_access then welcome_modal_shown, once each',
      JSON.stringify(events) === JSON.stringify(['desktop_first_access', 'welcome_modal_shown']),
      events,
    )
  }

  console.log('\n[5] recordWelcomeModalSeen — exempt and pro agencies emit nothing')
  {
    const exemptId = await seedAgency({ trialExempt: true })
    const proId = await seedAgency({ plan: 'pro' })
    await recordWelcomeModalSeen(exemptId)
    await recordWelcomeModalSeen(proId)
    check('exempt agency: zero events', (await eventsFor(exemptId)).length === 0)
    check('pro agency: zero events', (await eventsFor(proId)).length === 0)
  }

  console.log('\n[6] _trial_status view stays pinned to getTrialState — all five states')
  {
    const fixtures: Array<{ name: string; opts: Parameters<typeof seedAgency>[0]; expected: string }> = [
      { name: 'PAID', opts: { plan: 'pro' }, expected: 'PAID' },
      { name: 'LEGACY', opts: { trialExempt: true }, expected: 'LEGACY' },
      { name: 'NEVER_STARTED', opts: {}, expected: 'NEVER_STARTED' },
      {
        name: 'TRIAL_ACTIVE',
        opts: { trialStartedAt: new Date(Date.now() - 24 * h), trialEndsAt: new Date(Date.now() + 144 * h) },
        expected: 'TRIAL_ACTIVE',
      },
      {
        name: 'TRIAL_EXPIRED',
        opts: { trialStartedAt: new Date(Date.now() - 192 * h), trialEndsAt: new Date(Date.now() - 24 * h) },
        expected: 'TRIAL_EXPIRED',
      },
      {
        name: 'degenerate half-null (started set, ends null)',
        opts: { trialStartedAt: new Date(Date.now() - 24 * h) },
        expected: 'NEVER_STARTED',
      },
    ]
    for (const f of fixtures) {
      const id = await seedAgency(f.opts)
      const viewRow = await db('_trial_status').where({ agencyId: id }).first()
      const trialRow = await getAgencyTrial(id)
      const fnStatus = getTrialState(trialRow!, new Date()).status
      check(`${f.name}: view says ${f.expected}`, viewRow?.status === f.expected, viewRow?.status)
      check(`${f.name}: pure fn agrees with view`, fnStatus === viewRow?.status, { fnStatus, view: viewRow?.status })
    }
  }

  console.log('\n[7] _trial_status daysRemaining matches pure fn (active trial)')
  {
    const id = await seedAgency({
      trialStartedAt: new Date(Date.now() - 25 * h),
      trialEndsAt: new Date(Date.now() + 143 * h),
    })
    const viewRow = await db('_trial_status').where({ agencyId: id }).first()
    const trialRow = await getAgencyTrial(id)
    const fn = getTrialState(trialRow!, new Date())
    check('daysRemaining agrees', viewRow?.daysRemaining === fn.daysRemaining, {
      view: viewRow?.daysRemaining,
      fn: fn.daysRemaining,
    })
  }

  // ---- cleanup ----
  console.log('\n[cleanup]')
  await db('analytics_events').whereIn('agencyId', created).del()
  await db('agencies').whereIn('id', created).del()
  const leftoverAgencies = await db('agencies').where('name', 'like', TAG + '%')
  const leftoverEvents = await db('analytics_events').whereIn('agencyId', created)
  check('all seeded agencies deleted', leftoverAgencies.length === 0)
  check('all seeded events deleted', leftoverEvents.length === 0)

  await db.destroy()
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('verification crashed:', e)
  // Best-effort cleanup even on crash
  try {
    await db('analytics_events').whereIn('agencyId', created).del()
    await db('agencies').where('name', 'like', TAG + '%').del()
    await db.destroy()
  } catch {}
  process.exit(1)
})
