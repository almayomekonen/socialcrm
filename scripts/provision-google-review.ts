/**
 * Provision an isolated review workspace for Google's OAuth verification reviewer.
 *
 * Google's OAuth Verification team requested access for the reviewer account so they
 * can exercise the app's sensitive Google scopes (Drive `drive.readonly`, Calendar
 * `calendar.events`). This script gives that one account a dedicated, isolated
 * workspace with realistic data and NO trial/paywall gate — so the review cannot get
 * blocked no matter how long it runs.
 *
 * It adds ONLY data rows, using the app's own table shapes (mirrors `addAgency` and
 * `insertLeadSystem`). It does NOT touch authentication or authorization code, adds no
 * allowlist branch, no bypass, and no debug code. Isolation is by construction: a
 * dedicated agency is a separate tenant and every app query is scoped `.where({ agencyId })`,
 * so the reviewer sees ONLY these seeded leads — never real customer data.
 *
 * The reviewer's Google email is stored exactly as `normalizeEmail` produces it (already
 * lowercase/trimmed), so `checkUser` finds it on Google sign-in and lands them straight
 * in `/dashboard`. Magic-link login also works because the user row exists.
 *
 * ── Run against PRODUCTION ──────────────────────────────────────────────────────────
 * `config/db.ts` honours an already-set DATABASE_URL, so:
 *
 *   DATABASE_URL="postgres://…prod…?sslmode=require" npx tsx scripts/provision-google-review.ts
 *
 * Idempotent: re-running updates the flags and tops leads up to the target — never
 * duplicates the agency, user, or leads.
 *
 * ── Cleanup after verification (removes the reviewer + workspace entirely) ───────────
 *
 *   DATABASE_URL="postgres://…prod…?sslmode=require" npx tsx scripts/provision-google-review.ts --cleanup
 *
 * ── Reminder: one step lives OUTSIDE this repo ──────────────────────────────────────
 * In Google Cloud Console, add the reviewer email as a "Test User" on the OAuth
 * consent screen(s) for the Drive and Calendar OAuth clients (and the login client if
 * it is in "testing"). That is what lets the reviewer pass Google's consent screen for
 * the sensitive scopes — no code can do it.
 */
import { db } from '../config/db'
import { normalizeEmail } from '../lib/normalizeEmail'

// ── Reviewer / workspace identity ───────────────────────────────────────────────────
const REVIEWER_EMAIL = normalizeEmail('cerseilannister.642442@gmail.com')
const REVIEWER_FIRST_NAME = 'Google'
const REVIEWER_LAST_NAME = 'Reviewer'
const AGENCY_NAME = 'Google OAuth Review'
const PLAN_REASON = 'admin-grant:google-oauth-review'
const TARGET_LEAD_COUNT = 12

// ── Realistic seed leads (Hebrew, mixed sources + statuses) ─────────────────────────
// Statuses use the app's vocabulary: new | contacted | interested | closed | lost.
const day = 864e5
const daysAgo = (n: number) => new Date(Date.now() - n * day)
const daysFromNow = (n: number) => new Date(Date.now() + n * day)

const SEED_LEADS = [
  { firstName: 'דני', lastName: 'כהן', source: 'whatsapp', status: 'new', createdDaysAgo: 1 },
  { firstName: 'שרה', lastName: 'לוי', source: 'facebook', status: 'new', createdDaysAgo: 1 },
  {
    firstName: 'יוסי',
    lastName: 'מזרחי',
    source: 'instagram',
    status: 'contacted',
    createdDaysAgo: 3,
    lastActivityDaysAgo: 1,
    followUpInDays: 2,
    followUpNote: 'לחזור אחרי הצהריים',
  },
  { firstName: 'רחל', lastName: 'פרץ', source: 'whatsapp', status: 'contacted', createdDaysAgo: 4, lastActivityDaysAgo: 2 },
  {
    firstName: 'מיכאל',
    lastName: 'ביטון',
    source: 'facebook',
    status: 'interested',
    createdDaysAgo: 6,
    lastActivityDaysAgo: 1,
    followUpInDays: 1,
    followUpNote: 'שלח הצעת מחיר',
  },
  { firstName: 'נועה', lastName: 'אזולאי', source: 'instagram', status: 'interested', createdDaysAgo: 7, lastActivityDaysAgo: 3 },
  { firstName: 'אורי', lastName: 'חדד', source: 'whatsapp', status: 'new', createdDaysAgo: 2 },
  {
    firstName: 'תמר',
    lastName: 'ישראלי',
    source: 'facebook',
    status: 'contacted',
    createdDaysAgo: 5,
    lastActivityDaysAgo: 2,
    followUpInDays: 3,
    followUpNote: 'קבע פגישה',
  },
  { firstName: 'איתי', lastName: 'פרידמן', source: 'manual', status: 'closed', createdDaysAgo: 14, lastActivityDaysAgo: 4 },
  { firstName: 'יעל', lastName: 'שמש', source: 'whatsapp', status: 'closed', createdDaysAgo: 20, lastActivityDaysAgo: 6 },
  { firstName: 'רון', lastName: 'אלמוג', source: 'instagram', status: 'lost', createdDaysAgo: 18, lastActivityDaysAgo: 8 },
  { firstName: 'שירה', lastName: 'דהן', source: 'facebook', status: 'new', createdDaysAgo: 1 },
] as const

function dbHost(): string {
  try {
    return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Find the reviewer's user row (by normalized email) and its agency, if already provisioned. */
async function findExisting(): Promise<{ userId: number; agencyId: number } | null> {
  const user = await db('users').where({ email: REVIEWER_EMAIL }).first('id', 'agencyId')
  if (!user) return null
  return { userId: Number(user.id), agencyId: Number(user.agencyId) }
}

async function provision(): Promise<void> {
  console.log(`Target DB host: ${dbHost()}`)
  console.log(`Reviewer email: ${REVIEWER_EMAIL}`)

  // 1. Agency + user + info + settings (mirrors actions/agencies.ts addAgency exactly).
  let agencyId: number
  let userId: number

  const existing = await findExisting()
  if (existing) {
    agencyId = existing.agencyId
    userId = existing.userId
    console.log(`✓ Reviewer already exists — userId=${userId} agencyId=${agencyId}. Re-applying flags + topping up leads.`)
  } else {
    const created = await db.transaction(async (trx) => {
      const [agency] = await trx('agencies').insert({ name: AGENCY_NAME }).returning('id')
      const newAgencyId = Number(agency.id)
      const [user] = await trx('users')
        .insert({
          firstName: REVIEWER_FIRST_NAME,
          lastName: REVIEWER_LAST_NAME,
          email: REVIEWER_EMAIL,
          agencyId: newAgencyId,
          role: 'ADMIN',
        })
        .returning('*')
      await trx('users_info').insert({ id: user.id }).onConflict('id').merge()
      await trx('default_settings').insert({ userId: user.id })
      return { agencyId: newAgencyId, userId: Number(user.id) }
    })
    agencyId = created.agencyId
    userId = created.userId
    console.log(`✓ Created agency "${AGENCY_NAME}" (id=${agencyId}) + ADMIN user (id=${userId}).`)
  }

  // 2. Flags: never paywalled, no free-plan quota caps. Existing grandfather/grant flags.
  await db('agencies').where({ id: agencyId }).update({
    trialExempt: true,
    plan: 'pro',
    planReason: PLAN_REASON,
  })
  console.log(`✓ Agency flags set: trialExempt=true, plan=pro, planReason=${PLAN_REASON}`)

  // 3. Seed leads up to the target. The whole agency is dedicated, so its leads ARE the
  //    seed set — idempotency = "top up to TARGET_LEAD_COUNT", no per-row marker needed.
  const existingLeadsRow = await db('clients').where({ agencyId }).count<{ count: string }>('id as count').first()
  const existingLeads = Number(existingLeadsRow?.count ?? 0)
  const toInsert = SEED_LEADS.slice(existingLeads)

  if (toInsert.length === 0) {
    console.log(`✓ Leads already present (${existingLeads} ≥ ${TARGET_LEAD_COUNT}). Nothing to seed.`)
  } else {
    const stamp = Date.now()
    const rows = toInsert.map((lead, i) => {
      const idx = existingLeads + i
      const created = daysAgo(lead.createdDaysAgo)
      return {
        firstName: lead.firstName,
        lastName: lead.lastName,
        // Exactly 12 chars (972 + 9 digits), unique per row via the 2-digit index.
        // No lossy .slice() — truncating the index caused duplicate phones and a
        // clients_agency_phone_unique violation.
        phone: `9725${String(stamp).slice(-6)}${String(idx).padStart(2, '0')}`,
        leadSource: lead.source,
        status: lead.status,
        agencyId,
        userId,
        handlerId: userId,
        createdById: userId,
        lead: true,
        overQuota: false,
        statusChangedAt: created,
        createdAt: created,
        updatedAt: 'lastActivityDaysAgo' in lead ? daysAgo(lead.lastActivityDaysAgo as number) : created,
        lastActivityAt: 'lastActivityDaysAgo' in lead ? daysAgo(lead.lastActivityDaysAgo as number) : null,
        nextFollowUpAt: 'followUpInDays' in lead ? daysFromNow(lead.followUpInDays as number) : null,
        followUpNote: 'followUpNote' in lead ? (lead.followUpNote as string) : null,
      }
    })
    const inserted = await db('clients').insert(rows).returning('id')
    console.log(`✓ Seeded ${inserted.length} leads (agency now has ${existingLeads + inserted.length}).`)
  }

  console.log('\nDone. The reviewer can sign in with Google and will land in /dashboard.')
  console.log(
    'Reminder: add the reviewer email as a Test User on the Drive + Calendar OAuth consent screens in Google Cloud Console.',
  )
}

async function cleanup(): Promise<void> {
  console.log(`Target DB host: ${dbHost()}`)
  const existing = await findExisting()
  if (!existing) {
    console.log(`Nothing to clean up — no user found for ${REVIEWER_EMAIL}.`)
    return
  }
  const { userId, agencyId } = existing
  console.log(`Removing review workspace: userId=${userId} agencyId=${agencyId}`)

  await db.transaction(async (trx) => {
    // Optional integration rows the reviewer may have created — best-effort, tables may
    // not exist in every environment. Scoped strictly to this agency/user.
    for (const [table, where] of [
      ['meetings', { agencyId }],
      ['google_drive_connections', { agencyId }],
      ['google_calendar_connections', { agencyId }],
    ] as const) {
      try {
        await trx(table).where(where).del()
      } catch {
        /* table absent or differently keyed — ignore */
      }
    }
    await trx('clients').where({ agencyId }).del()
    await trx('default_settings').where({ userId }).del()
    await trx('users_info').where({ id: userId }).del()
    await trx('users').where({ id: userId }).del()
    await trx('agencies').where({ id: agencyId }).del()
  })

  console.log('✓ Review workspace removed (agency, user, leads, and any integration rows).')
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Refusing to run. Set it to the target database and re-run.')
    process.exit(1)
  }
  const isCleanup = process.argv.includes('--cleanup')
  if (isCleanup) await cleanup()
  else await provision()
  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
