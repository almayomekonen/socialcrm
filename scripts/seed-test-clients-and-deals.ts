/**
 * Seeds the test user's agency up to a target volume of clients (closed
 * leads — rows in the `clients` table with `lead = false`) and deals.
 *
 * Mirrors the structure of seed-test-leads-and-deals.ts, but targets the
 * /clients route data instead of /leads. Idempotent top-up: never inserts
 * past the target, never deletes existing rows.
 *
 * Run:  pnpm mig seed-test-clients-and-deals.ts
 */

import { db } from '../config/db'

const EMAIL = 'alamayo274@gmail.com'
const TARGET_CLIENTS = 40
const TARGET_DEALS = 40

const firstNames = [
  'אבי', 'דני', 'יוסי', 'שרה', 'רחל', 'מיכאל', 'דוד', 'רות', 'חנה', 'נועה',
  'אורי', 'גיל', 'ליאור', 'תמר', 'יעל', 'איתי', 'בן', 'רון', 'עדי', 'שירה',
  'מאיה', 'נועם', 'אלון', 'עומר', 'טל', 'אופיר', 'ירון', 'הילה', 'גלית', 'קרן',
  'סיגל', 'דורון', 'אמיר', 'אלה', 'יובל', 'נדב',
]

const lastNames = [
  'כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אזולאי', 'חדד', 'ישראלי', 'פרידמן',
  'שמש', 'אלמוג', 'דהן', 'ברקוביץ', 'גולדשטיין', 'אברהם', 'רוזן', 'שפירו',
  'קפלן', 'סגל', 'נחום',
]

// Clients are mostly "closed" (the canonical client state in this system),
// with a smattering of other statuses so the status column has visual variance
// for table-density testing.
const clientStatuses = [
  'closed', 'closed', 'closed', 'closed', 'closed', 'closed',
  'closed', 'closed', 'interested', 'contacted', 'lost', 'new',
]

const leadSources = ['Instagram', 'Facebook', 'WhatsApp', 'אתר', 'המלצה', 'פרסום ממומן', 'אורגני', 'TikTok', 'Google']
const genders = ['זכר', 'נקבה']
const familyStatuses = ['נשוי/ה', 'רווק/ה', 'גרוש/ה', 'אלמן/ה']

const dealStatuses = ['הצעה נשלחה', 'ממתין לפרטים', 'תשלום ראשון התקבל', 'בטיפול', 'בבדיקה', 'הושלם', 'שולם במלואו', 'בוטל']
const completedDealStatuses = new Set(['הושלם', 'שולם במלואו'])

const deals = [
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'Meta', amount: 3500 },
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'TikTok', amount: 4200 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Google', amount: 5000 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Meta', amount: 4500 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 2800 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1500 },
  { branch: 'שירותים', prdct: 'עיצוב גרפי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2200 },
  { branch: 'שירותים', prdct: 'הפקת תוכן וידאו', prdctType: 'תשלום חד פעמי', company: 'TikTok', amount: 3800 },
  { branch: 'שירותים', prdct: 'הפקת תוכן וידאו', prdctType: 'תשלום חודשי', company: 'YouTube', amount: 6000 },
  { branch: 'שירותים', prdct: 'ניהול קהילה', prdctType: 'תשלום חודשי', company: 'Meta', amount: 2200 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'Wix', amount: 8500 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'WordPress', amount: 6500 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'React', amount: 14000 },
  { branch: 'מוצרים', prdct: 'זהות מותגית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 4800 },
  { branch: 'מוצרים', prdct: 'חנות אונליין', prdctType: 'תשלום חד פעמי', company: 'Shopify', amount: 12000 },
  { branch: 'מוצרים', prdct: 'אפליקציה', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 18000 },
  { branch: 'מנויים', prdct: 'מנוי ניהול תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 1800 },
  { branch: 'מנויים', prdct: 'מנוי SEO', prdctType: 'תשלום חודשי', company: 'Google', amount: 2500 },
  { branch: 'מנויים', prdct: 'מנוי דיוור ומיילים', prdctType: 'תשלום חודשי', company: 'Mailchimp', amount: 1200 },
  { branch: 'מנויים', prdct: 'מנוי אנליטיקס', prdctType: 'תשלום חודשי', company: 'Google', amount: 1500 },
  { branch: 'ייעוץ', prdct: 'ייעוץ אסטרטגי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 3000 },
  { branch: 'ייעוץ', prdct: 'ייעוץ שיווקי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2500 },
  { branch: 'ייעוץ', prdct: 'ליווי עסקי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3500 },
  { branch: 'קורסים', prdct: 'קורס פרסום ממומן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1200 },
  { branch: 'קורסים', prdct: 'קורס מדיה חברתית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 980 },
  { branch: 'חבילות', prdct: 'חבילת סטארטר', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3200 },
  { branch: 'חבילות', prdct: 'חבילת פרו', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 5500 },
  { branch: 'חבילות', prdct: 'חבילת אנטרפרייז', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 9800 },
] as const

const noteOptions = [
  'לקוח מאוד מעוניין, לחזור בשבוע הבא',
  'שלחנו הצעה מפורטת',
  'לקוח ביקש הנחה נוספת',
  'חוזה נחתם, ממתין לתשלום',
  'שיחת מעקב בוצעה, מרוצה מהשירות',
  'הפניה מלקוח קיים',
  'נשלחה חשבונית, ממתין לאישור',
  null,
  null,
]

const rand = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)
const randomBirthDate = () => {
  const start = new Date('1965-01-01').getTime()
  const end = new Date('2003-12-31').getTime()
  return new Date(start + Math.random() * (end - start))
}

async function countClients(agencyId: number) {
  const row = await db('clients').where({ agencyId, lead: false }).count<{ count: string }>('id as count').first()
  return Number(row?.count ?? 0)
}

async function countDeals(agencyId: number) {
  const row = await db('sales').where({ agencyId }).count<{ count: string }>('id as count').first()
  return Number(row?.count ?? 0)
}

async function topUpClients(userId: number, agencyId: number, current: number): Promise<number[]> {
  if (current >= TARGET_CLIENTS) {
    console.log(`clients already at ${current} (target ${TARGET_CLIENTS}), no inserts needed`)
    return []
  }

  const need = TARGET_CLIENTS - current
  const stamp = Date.now()
  console.log(`inserting ${need} clients…`)

  const rows = Array.from({ length: need }, (_, i) => {
    const firstName = rand(firstNames)
    const lastName = rand(lastNames)
    const status = rand(clientStatuses)
    // Clients are typically older than leads — broaden the lookback window so
    // the createdAt distribution stresses time-based filters too.
    const ageDays = randInt(0, 180)
    const createdAt = daysAgo(ageDays)
    const statusAgeDays = Math.max(0, ageDays - randInt(0, Math.min(ageDays, 30)))
    const statusChangedAt = daysAgo(statusAgeDays)
    const lastActivityAt = Math.random() < 0.7 ? daysAgo(randInt(0, ageDays)) : null

    // Phone must be unique. Different prefix (`0502`) than the leads seed
    // (`0501`) so the two scripts can coexist without collisions across reruns.
    const phoneSuffix = String(stamp + i).slice(-7)

    return {
      firstName,
      lastName,
      phone: `0502${phoneSuffix}`,
      email: `${firstName}.client${stamp}${i}@test.local`,
      gender: rand(genders),
      familyStatus: rand(familyStatuses),
      birthDate: randomBirthDate(),
      leadSource: `seed:test-client:${stamp}:${i}`,
      status,
      rank: randInt(1, 3),
      lead: false,
      overQuota: false,
      agencyId,
      userId,
      handlerId: userId,
      createdById: userId,
      createdAt,
      updatedAt: createdAt,
      statusChangedAt,
      lastActivityAt,
    }
  })

  const inserted = await db('clients').insert(rows).returning('id')
  const ids = inserted.map((r: any) => Number(r.id))
  console.log(`inserted ${ids.length} clients`)
  return ids
}

async function topUpDeals(userId: number, agencyId: number, current: number): Promise<number> {
  if (current >= TARGET_DEALS) {
    console.log(`deals already at ${current} (target ${TARGET_DEALS}), no inserts needed`)
    return 0
  }

  const need = TARGET_DEALS - current

  // Prefer rows owned by this user; fall back to any row in the agency.
  // Pool is the same as the leads-and-deals script — deals can attach to
  // anything in the `clients` table regardless of the `lead` flag.
  const candidates = await db('clients')
    .where({ agencyId })
    .andWhere((qb) => qb.where('userId', userId).orWhere('handlerId', userId))
    .select('id', 'lead')

  const pool = candidates.length > 0 ? candidates : await db('clients').where({ agencyId }).select('id', 'lead')

  if (pool.length === 0) {
    console.log('cannot insert deals: no clients exist for this agency')
    return 0
  }

  const ids: number[] = pool.map((c: any) => Number(c.id))
  console.log(`inserting ${need} deals across ${ids.length} client rows…`)

  let insertedCount = 0
  for (let i = 0; i < need; i++) {
    const deal = deals[i % deals.length]
    const clientId = rand(ids)
    const status = rand(dealStatuses)
    const isCompleted = completedDealStatuses.has(status)
    const offrDt = daysAgo(randInt(0, 45))
    const saleDt = isCompleted ? daysAgo(randInt(0, 30)) : null
    const isMonthly = deal.prdctType === 'תשלום חודשי'
    const tfuca = isMonthly ? deal.amount * 12 : deal.amount
    const cmsnRate = randInt(8, 15) / 100
    const cmsn = Math.round(tfuca * cmsnRate)
    const notes = rand(noteOptions)

    try {
      const [sale] = await db('sales')
        .insert({
          status,
          action: rand(['מכירה', 'ליד', 'חידוש', 'שדרוג']),
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
          notes,
          replace: false,
          rwrd: Math.random() < 0.1,
          leadSource: rand(leadSources),
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

      insertedCount++
    } catch (e: any) {
      console.log(`  ⚠ skipped a deal: ${e.message}`)
    }
  }

  console.log(`inserted ${insertedCount} deals`)
  return insertedCount
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

  const clientsBefore = await countClients(agencyId)
  const dealsBefore = await countDeals(agencyId)
  console.log(`clients before: ${clientsBefore} | deals before: ${dealsBefore}`)

  await topUpClients(user.id, agencyId, clientsBefore)
  const dealsAfterClients = await countDeals(agencyId)
  await topUpDeals(user.id, agencyId, dealsAfterClients)

  const clientsAfter = await countClients(agencyId)
  const dealsAfter = await countDeals(agencyId)
  console.log('')
  console.log(`agencyId       : ${agencyId}`)
  console.log(`clients before : ${clientsBefore}  →  after: ${clientsAfter}  (target ${TARGET_CLIENTS})`)
  console.log(`deals before   : ${dealsBefore}  →  after: ${dealsAfter}  (target ${TARGET_DEALS})`)

  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
