/**
 * Seed 6 demo deals locally for the test user.
 *
 *   npx tsx scripts/seed-deals-local.ts
 *
 * Idempotent: skips if 6 seed deals already exist.
 */
import { db } from '../config/db'

const EMAIL = 'alamayo274@gmail.com'
const SEED_NOTES_PREFIX = 'seed:deals:demo'

const DEALS = [
  {
    branch: 'שירותים',
    prdct: 'מערכת CRM',
    prdctType: 'תשלום חודשי',
    company: 'ללא ספק',
    amount: 4500,
    status: 'הצעה נשלחה',
    notes: `${SEED_NOTES_PREFIX}:1 — ליד מוואטסאפ, מחפש CRM לניהול לידים`,
  },
  {
    branch: 'שירותים',
    prdct: 'ניהול מדיה חברתית',
    prdctType: 'תשלום חודשי',
    company: 'Meta',
    amount: 3500,
    status: 'בטיפול',
    notes: `${SEED_NOTES_PREFIX}:2 — שלחנו הצעה, ממתין לתשובה`,
  },
  {
    branch: 'מוצרים',
    prdct: 'בניית אתר',
    prdctType: 'תשלום חד פעמי',
    company: 'Wix',
    amount: 8500,
    status: 'ממתין לפרטים',
    notes: `${SEED_NOTES_PREFIX}:3 — ביקש פירוט על חבילות`,
  },
  {
    branch: 'חבילות',
    prdct: 'חבילת פרו',
    prdctType: 'תשלום חודשי',
    company: 'ללא ספק',
    amount: 5500,
    status: 'תשלום ראשון התקבל',
    notes: `${SEED_NOTES_PREFIX}:4 — סגר דמו, התחיל תשלום`,
  },
  {
    branch: 'ייעוץ',
    prdct: 'ליווי עסקי',
    prdctType: 'תשלום חודשי',
    company: 'ללא ספק',
    amount: 3500,
    status: 'הושלם',
    notes: `${SEED_NOTES_PREFIX}:5 — חוזה ל-3 חודשים`,
  },
  {
    branch: 'שירותים',
    prdct: 'פרסום ממומן',
    prdctType: 'תשלום חודשי',
    company: 'Google',
    amount: 5000,
    status: 'שולם במלואו',
    notes: `${SEED_NOTES_PREFIX}:6 — ליד חם, סגר מהר`,
  },
] as const

const COMPLETED = new Set(['הושלם', 'שולם במלואו'])
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)

/** Keep offer dates in the current month so admin default filter (החודש הנוכחי) shows them. */
function offerDate(daysBack: number): Date {
  const d = daysAgo(daysBack)
  const now = new Date()
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return d
  return daysAgo(Math.min(daysBack, Math.max(0, now.getDate() - 1)))
}

async function run() {
  const dbHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'unknown'
  const user = await db('users').where({ email: EMAIL }).first()
  if (!user) {
    console.error(`User not found: ${EMAIL}`)
    process.exit(1)
  }

  const agencyId = Number(user.agencyId)
  const userId = Number(user.id)
  console.log(`Target: ${EMAIL} agencyId=${agencyId} db=${dbHost}`)

  const existing = await db('sales')
    .where({ agencyId })
    .whereLike('notes', `${SEED_NOTES_PREFIX}:%`)
    .count('id as c')
    .first()
  const existingCount = Number(existing?.c ?? 0)
  if (existingCount >= DEALS.length) {
    // Re-date existing seeds so they pass the admin default "current month" filter.
    const refreshed = await db('sales')
      .where({ agencyId })
      .whereLike('notes', `${SEED_NOTES_PREFIX}:%`)
      .orderBy('id', 'asc')
      .select('id', 'status')

    for (let i = 0; i < refreshed.length; i++) {
      const row = refreshed[i]
      const isCompleted = COMPLETED.has(row.status as string)
      const offrDt = offerDate(i * 2 + 1)
      const saleDt = isCompleted ? offerDate(i) : null
      await db('sales').where({ id: row.id }).update({ offrDt, saleDt, updatedAt: new Date() })
    }

    console.log(`Already seeded (${existingCount} demo deals). Refreshed dates to current month.`)
    await db.destroy()
    return
  }

  const clientPool = await db('clients')
    .where({ agencyId })
    .orderBy('id', 'desc')
    .limit(20)
    .select('id')

  if (clientPool.length === 0) {
    console.error('No clients/leads in agency — run seed-test-leads.ts first.')
    process.exit(1)
  }

  let inserted = 0
  for (let i = 0; i < DEALS.length; i++) {
    const deal = DEALS[i]
    const already = await db('sales').where({ agencyId, notes: deal.notes }).first('id')
    if (already) {
      console.log(`  = deal ${i + 1}: ${deal.prdct} (exists)`)
      continue
    }

    const clientId = Number(clientPool[i % clientPool.length].id)
    const isCompleted = COMPLETED.has(deal.status)
    const offrDt = offerDate(i * 2 + 1)
    const saleDt = isCompleted ? offerDate(i) : null
    const isMonthly = deal.prdctType === 'תשלום חודשי'
    const tfuca = isMonthly ? deal.amount * 12 : deal.amount
    const cmsn = Math.round(tfuca * 0.12)

    const [sale] = await db('sales')
      .insert({
        status: deal.status,
        action: 'מכירה',
        company: deal.company,
        branch: deal.branch,
        prdct: deal.prdct,
        prdctType: deal.prdctType,
        offrDt,
        saleDt,
        clientId,
        createdById: userId,
        handlerId: userId,
        amount: deal.amount,
        cmsn,
        notes: deal.notes,
        replace: false,
        rwrd: false,
        leadSource: 'WhatsApp',
        agencyId,
      })
      .returning('id')

    await db('sale_users').insert({
      saleId: sale.id,
      userId,
      prcnt: 100,
      amount: deal.amount,
      cmsn,
      tfuca,
    })

    inserted++
    console.log(`  + deal ${i + 1}: ${deal.prdct} (${deal.status}) → client ${clientId}`)
  }

  const total = await db('sales').where({ agencyId }).count('id as c').first()
  console.log(`\nDone. Inserted ${inserted} deals. Agency total: ${total?.c} deals.`)

  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
