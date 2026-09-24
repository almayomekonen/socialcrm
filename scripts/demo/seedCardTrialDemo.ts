/**
 * Seeds the card-required trial walkthrough into a LOCAL demo database and
 * prints one magic-link sign-in per scenario.
 *
 * Everything here is synthetic. It writes no Grow data, contacts no provider and
 * charges nothing: the "payment" rows are inserted directly so the UI states can
 * be seen. The card-setup and callback steps in the browser go through the real
 * routes with the local Grow mock (lib/payments/grow/localMock.ts).
 *
 * SAFETY. Refuses any database that is not a local one whose name contains
 * "demo": the connection must be localhost and the name must match, so this can
 * never be pointed at production or at the shared test database.
 *
 *   DATABASE_URL=postgres://…/socialcrm_card_demo_test \
 *   APP_BASE=http://localhost:3002 npx tsx scripts/demo/seedCardTrialDemo.ts
 */
import knex from 'knex'
import { randomBytes } from 'crypto'

const RAW_URL = process.env.DATABASE_URL ?? ''
const APP_BASE = (process.env.APP_BASE || 'http://localhost:3002').replace(/\/$/, '')
/** Magic links are single-use. Re-run with LINKS_ONLY=1 to mint fresh ones without rebuilding the data. */
const LINKS_ONLY = process.env.LINKS_ONLY === '1'

function assertLocalDemoDatabase(raw: string): URL {
  const url = new URL(raw)
  const name = url.pathname.replace(/^\//, '')
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (!local) throw new Error(`refusing a non-local database host`)
  if (!/demo/.test(name)) throw new Error(`refusing a database whose name is not a demo one: ${name}`)
  return url
}

const url = assertLocalDemoDatabase(RAW_URL)
const db = knex({ client: 'pg', connection: { connectionString: url.toString(), ssl: false }, pool: { min: 0, max: 4 } })

const hours = (h: number) => new Date(Date.now() + h * 3_600_000)
const token = () => randomBytes(32).toString('hex')

type Scenario = {
  slug: string
  title: string
  where: string
  build: (agencyId: number, userId: number) => Promise<void>
  agency?: Record<string, unknown>
}

async function seedMethod(agencyId: number, over: Record<string, unknown> = {}) {
  const [row] = await db('billing_payment_methods')
    .insert({
      agencyId,
      providerMode: 'sandbox',
      purpose: 'trial_start',
      status: 'active',
      reference: `demo-${randomBytes(8).toString('hex')}`,
      holderFullName: 'ישראל ישראלי',
      holderPhone: '0501234567',
      termsVersion: '2026-09-15',
      termsAcceptedAt: new Date(),
      cardToken: 'demo-not-a-real-token',
      cardSuffix: '4242',
      cardBrand: 'Visa',
      cardExp: '1230',
      confirmedAt: new Date(),
      ...over,
    })
    .returning('id')
  return Number(row.id)
}

async function seedCharge(agencyId: number, paymentMethodId: number, over: Record<string, unknown> = {}) {
  await db('billing_charges').insert({
    agencyId,
    paymentMethodId,
    kind: 'trial_conversion',
    periodKey: 'trial_end',
    groupIdentifier: Math.floor(Date.now() / 1000),
    attempt: 1,
    amount: 89,
    billingPeriod: 'monthly',
    status: 'pending',
    ...over,
  })
}

const SCENARIOS: Scenario[] = [
  {
    slug: 'welcome',
    title: '1. Welcome modal — cardholder fields, disclosure, consent, CTA',
    where: '/dashboard (the modal opens by itself)',
    build: async () => {},
  },
  {
    slug: 'awaiting',
    title: '2. Card setup returned, awaiting server verification',
    where: '/billing/success?source=card_trial',
    build: async (agencyId) => {
      await seedMethod(agencyId, {
        status: 'pending', cardToken: null, confirmedAt: null, cardSuffix: null, cardBrand: null,
        setupProcessId: `demo-proc-${agencyId}`, lastCallbackAt: new Date(), lastVerificationError: 'provider_evidence_missing',
      })
    },
  },
  {
    slug: 'active',
    title: '3. Verified active trial (card saved, not charged)',
    where: '/settings/update_payment',
    agency: { trialStartedAt: hours(-48), trialEndsAt: hours(120) },
    build: async (agencyId) => {
      await seedMethod(agencyId)
      await db('subscriptions').insert({ agencyId, cancelAtPeriodEnd: false, billingPeriod: 'monthly' })
    },
  },
  {
    slug: 'cancelled',
    title: '8. Cancelled subscription (access continues, no further charge)',
    where: '/settings/update_payment',
    agency: { trialStartedAt: hours(-48), trialEndsAt: hours(120) },
    build: async (agencyId) => {
      await seedMethod(agencyId)
      await db('subscriptions').insert({ agencyId, cancelAtPeriodEnd: true, billingPeriod: 'monthly' })
    },
  },
  {
    slug: 'in-flight',
    title: '7. Payment in progress / outcome unknown',
    where: '/settings/update_payment',
    agency: { trialStartedAt: hours(-170), trialEndsAt: hours(-0.5) },
    build: async (agencyId) => {
      const pm = await seedMethod(agencyId)
      await db('subscriptions').insert({ agencyId, cancelAtPeriodEnd: false, billingPeriod: 'monthly' })
      await seedCharge(agencyId, pm, { status: 'unknown', dispatchedAt: new Date(), errorClass: 'transport_timeout' })
    },
  },
  {
    slug: 'declined',
    title: '6. Declined payment → expired trial with card recovery',
    where: '/dashboard (expired screen) then /settings/update_payment',
    agency: { trialStartedAt: hours(-200), trialEndsAt: hours(-30) },
    build: async (agencyId) => {
      const pm = await seedMethod(agencyId, { status: 'invalid', invalidReason: 'final_decline' })
      await db('subscriptions').insert({ agencyId, cancelAtPeriodEnd: false, billingPeriod: 'monthly' })
      await seedCharge(agencyId, pm, { status: 'failed_final', dispatchedAt: new Date(), errorClass: 'final', errorMessage: 'demo decline' })
    },
  },
  {
    slug: 'expired',
    title: '5. Expired trial → reactivation with a new card',
    where: '/dashboard (expired screen)',
    agency: { trialStartedAt: hours(-200), trialEndsAt: hours(-30) },
    build: async (agencyId) => {
      await seedMethod(agencyId, { status: 'replaced' })
      await db('subscriptions').insert({ agencyId, cancelAtPeriodEnd: false, billingPeriod: 'monthly' })
    },
  },
]

async function createAgency(scenario: Scenario, index: number) {
  const email = `demo.${scenario.slug}@socialcrm.local`
  const [agency] = await db('agencies')
    .insert({
      name: `דמו — ${scenario.slug}`,
      plan: 'free',
      trialExempt: false,
      // Past the connect-a-channel onboarding, so every scenario lands on the
      // billing/trial surface it is meant to show.
      onboardingCompletedAt: new Date(),
      ...(scenario.agency ?? {}),
    })
    .returning('id')
  const agencyId = Number(agency.id)
  const [user] = await db('users')
    .insert({
      agencyId,
      firstName: 'ישראל',
      // Letters only: the cardholder validator (Grow requires two names, no
      // digits) refuses anything else, so a demo name with a number in it would
      // fail the very form this walkthrough is meant to show.
      lastName: ['ישראלי', 'כהן', 'לוי', 'מזרחי', 'פרץ', 'אביטן', 'שמש'][index % 7],
      email,
      role: 'ADMIN',
      otp: { token: '', tokenExpiry: null },
    })
    .returning('id')
  const userId = Number(user.id)
  await scenario.build(agencyId, userId)

  const magic = token()
  await db('users').where({ id: userId }).update({ otp: { token: magic, tokenExpiry: hours(24 * 30) } })
  return { agencyId, userId, email, link: `${APP_BASE}/api/magic?email=${encodeURIComponent(email)}&token=${magic}` }
}

async function mintLinksOnly() {
  const users = await db('users').where('email', 'like', 'demo.%@socialcrm.local').select('id', 'email', 'agencyId')
  const out = []
  for (const user of users) {
    const magic = token()
    await db('users').where({ id: user.id }).update({ otp: { token: magic, tokenExpiry: hours(24 * 30) } })
    const slug = String(user.email).replace(/^demo\./, '').replace(/@socialcrm\.local$/, '')
    const scenario = SCENARIOS.find((s) => s.slug === slug)
    out.push({ scenario: scenario?.title ?? slug, where: scenario?.where ?? '', agencyId: user.agencyId, signIn: `${APP_BASE}/api/magic?email=${encodeURIComponent(user.email)}&token=${magic}` })
  }
  console.log(JSON.stringify(out, null, 2))
  await db.destroy()
}

async function main() {
  if (LINKS_ONLY) return mintLinksOnly()
  const existing = await db('users').where('email', 'like', 'demo.%@socialcrm.local').pluck('agencyId')
  if (existing.length) {
    const ids = [...new Set(existing.map(Number))]
    await db('billing_charges').whereIn('agencyId', ids).delete()
    await db('billing_payment_methods').whereIn('agencyId', ids).delete()
    await db('subscriptions').whereIn('agencyId', ids).delete()
    await db('analytics_events').whereIn('agencyId', ids).delete()
    await db('users').whereIn('agencyId', ids).delete()
    await db('agencies').whereIn('id', ids).delete()
  }

  const out: Record<string, unknown>[] = []
  for (const [i, scenario] of SCENARIOS.entries()) {
    const created = await createAgency(scenario, i)
    out.push({ scenario: scenario.title, where: scenario.where, agencyId: created.agencyId, signIn: created.link })
  }
  console.log(JSON.stringify(out, null, 2))
  await db.destroy()
}

main().catch(async (err) => {
  console.error(String(err))
  await db.destroy()
  process.exit(1)
})
