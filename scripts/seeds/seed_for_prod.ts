/**
 * Production seed for a specific user.
 * Usage (against production DB):
 *   DATABASE_URL=<prod_url> npx tsx scripts/seeds/seed_for_prod.ts
 *
 * Seeds: 100 leads, 100 deals, 50 tasks, 10 promos
 * Note: sum_sales data is derived from deals — no separate table to seed.
 */

import { db } from '@/config/db'

const TARGET_EMAIL = 'alamayo274@gmail.com'

// ── helpers ──────────────────────────────────────────────────────────────────
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const randNum = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)
const daysFromNow = (n: number) => new Date(Date.now() + n * 864e5)
const monthsAgo = (n: number) => new Date(Date.now() - n * 30 * 864e5)

// ── data pools ────────────────────────────────────────────────────────────────
const firstNames = [
  'נועה',
  'אייל',
  'שירה',
  'יוסי',
  'מיה',
  'דן',
  'תמר',
  'אורן',
  'ליאת',
  'גל',
  'רון',
  'הילה',
  'ניר',
  'דנה',
  'עמית',
  'יעל',
  'אסף',
  'מור',
  'נתן',
  'שני',
  'לירון',
  'אבי',
  'רחל',
  'מתן',
  'אדם',
  'חן',
  'בר',
  'טל',
  'עדן',
  'אלון',
  'מיכל',
  'יונתן',
  'שרה',
  'איתי',
  'רוני',
  'גיא',
  'שקד',
  'נבו',
  'מאיה',
  'אור',
]

const lastNames = [
  'לוי',
  'כהן',
  'מזרחי',
  'פרץ',
  'ביטון',
  'אברהם',
  'שפירו',
  'רוזן',
  'גרינברג',
  'אדרי',
  'פרידמן',
  'אלוני',
  'שמש',
  'דגן',
  'קפלן',
  'סגל',
  'נחום',
  'חזן',
  'יוסף',
  'אלקבץ',
  'בן דוד',
  'נוי',
  'שלום',
  'גולן',
  'אמסלם',
  'בר',
  'נגר',
  'סרוסי',
  'מלכה',
  'עזרא',
]

const leadSources = ['Facebook', 'Instagram', 'WhatsApp', 'אתר', 'המלצה', 'פרסום ממומן', 'אורגני']
const leadStatuses = ['new', 'new', 'new', 'contacted', 'contacted', 'interested', 'closed', 'lost']

const dealStatuses = ['חדש', 'חדש', 'חדש', 'בהצעה', 'בהצעה', 'במו"מ', 'במו"מ', 'ממתין לתשלום', 'שולם', 'שולם', 'בוטל']

const notes = [
  'לקוח מאוד מעוניין, לחזור בשבוע הבא',
  'ממתין לאישור מנהל',
  'שלחנו הצעה מפורטת',
  'לקוח ביקש הנחה נוספת',
  'חוזה נחתם, ממתין לתשלום',
  'הפניה מלקוח קיים',
  'ניהול משא ומתן על תנאים',
  'בקשה לשדרוג חבילה קיימת',
  null,
  null,
  null,
]

const deals = [
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'Meta', amount: 3500 },
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'TikTok', amount: 4200 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 2800 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1500 },
  { branch: 'שירותים', prdct: 'עיצוב גרפי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2200 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Google', amount: 5000 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Meta', amount: 4500 },
  { branch: 'שירותים', prdct: 'הפקת תוכן וידאו', prdctType: 'תשלום חד פעמי', company: 'TikTok', amount: 3800 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 8500 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 14000 },
  { branch: 'מוצרים', prdct: 'זהות מותגית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 4800 },
  { branch: 'מוצרים', prdct: 'חנות אונליין', prdctType: 'תשלום חד פעמי', company: 'Shopify', amount: 12000 },
  { branch: 'מוצרים', prdct: 'מערכת CRM', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 15000 },
  { branch: 'מנויים', prdct: 'מנוי ניהול תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 1800 },
  { branch: 'מנויים', prdct: 'מנוי SEO', prdctType: 'תשלום חודשי', company: 'Google', amount: 2500 },
  { branch: 'מנויים', prdct: 'מנוי דיוור ומיילים', prdctType: 'תשלום חודשי', company: 'Mailchimp', amount: 1200 },
  { branch: 'מנויים', prdct: 'מנוי אנליטיקס', prdctType: 'תשלום חודשי', company: 'Google', amount: 1500 },
  { branch: 'ייעוץ', prdct: 'ייעוץ אסטרטגי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 3000 },
  { branch: 'ייעוץ', prdct: 'ייעוץ שיווקי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2500 },
  { branch: 'ייעוץ', prdct: 'ליווי עסקי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3500 },
  { branch: 'קורסים', prdct: 'קורס פרסום ממומן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1200 },
  { branch: 'קורסים', prdct: 'קורס מדיה חברתית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 980 },
  { branch: 'קורסים', prdct: 'קורס שיווק דיגיטלי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1600 },
  { branch: 'חבילות', prdct: 'חבילת סטארטר', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3200 },
  { branch: 'חבילות', prdct: 'חבילת פרו', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 5500 },
  { branch: 'חבילות', prdct: 'חבילת אנטרפרייז', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 9800 },
  { branch: 'חבילות', prdct: 'חבילת מדיה', prdctType: 'תשלום חד פעמי', company: 'Meta', amount: 18000 },
  { branch: 'אחר', prdct: 'אחר', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2000 },
]

const taskTemplates = [
  { title: 'אונבורדינג לקוח חדש', status: 'פתוח' },
  { title: 'ניהול קמפיין ממומן - Meta', status: 'פתוח' },
  { title: 'בניית אתר עסקי', status: 'ממתין לאישור הצעה' },
  { title: 'דוח ביצועים חודשי', status: 'הסתיים טיפול' },
  { title: 'הגשת הצעת מחיר', status: 'ממתין לחתימת לקוח' },
  { title: 'ניהול מדיה חברתית', status: 'פתוח' },
  { title: 'קמפיין Google Ads', status: 'חדש' },
  { title: 'צילום תוכן לרשתות חברתיות', status: 'ממתין לפנייה ללקוח' },
  { title: 'חידוש חוזה שנתי', status: 'ממתין לחתימת לקוח' },
  { title: 'SEO — אופטימיזציה לאתר', status: 'פתוח' },
  { title: 'השקת ניוזלטר חודשי', status: 'פתוח' },
  { title: 'טסט A/B לדפי נחיתה', status: 'חדש' },
  { title: 'טיפול בפידבק שלילי', status: "ריג'קט לטיפול" },
  { title: 'עדכון אסטרטגיה רבעונית', status: 'חדש' },
  { title: 'חיבור CRM ואוטומציה', status: 'פתוח' },
  { title: 'פגישת היכרות ראשונית', status: 'הסתיים טיפול' },
  { title: 'מעקב תשלום חשבונית', status: 'ממתין לפנייה ללקוח' },
  { title: 'הקמת חנות Shopify', status: 'פתוח' },
  { title: 'ניהול קהילה - Discord', status: 'חדש' },
  { title: 'אינטגרציה — Meta Lead Ads', status: 'ממתין לאישור הצעה' },
]

// ── seed functions ────────────────────────────────────────────────────────────
async function seedLeads(userId: number, agencyId: number, count: number): Promise<number[]> {
  console.log(`\n🌱 Seeding ${count} leads...`)
  const ids: number[] = []

  // Unique base per run so re-runs don't collide
  const seedBase = Date.now() % 9000000

  for (let i = 0; i < count; i++) {
    const firstName = firstNames[i % firstNames.length]
    const lastName = lastNames[i % lastNames.length]
    const phone = `052${String(1000000 + seedBase + i).slice(-7)}`
    const email = `seed.${seedBase}.${i}@example-crm.com`
    const status = rand(leadStatuses)
    const statusChangedAt = daysAgo(randNum(0, 90))

    try {
      const [row] = await db('clients')
        .insert({
          firstName,
          lastName,
          phone,
          email,
          lead: true,
          leadSource: rand(leadSources),
          status,
          statusChangedAt,
          userId,
          handlerId: userId,
          createdById: userId,
          agencyId,
        })
        .returning('id')

      ids.push(row.id)
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${count}`)
    } catch (e: any) {
      console.log(`  ⚠ lead ${i + 1}: ${e.message}`)
    }
  }

  console.log(`✅ Leads seeded: ${ids.length}`)
  return ids
}

async function seedDeals(userId: number, agencyId: number, clientIds: number[], count: number) {
  console.log(`\n🌱 Seeding ${count} deals (visible in sum_sales)...`)
  let inserted = 0

  for (let i = 0; i < count; i++) {
    const deal = deals[i % deals.length]
    const status = rand(dealStatuses)
    const isMonthly = deal.prdctType === 'תשלום חודשי'
    const tfuca = isMonthly ? deal.amount * 12 : deal.amount
    const cmsnRate = randNum(8, 15) / 100
    const cmsn = Math.round(tfuca * cmsnRate)
    // Spread dates across last 12 months for rich sum_sales charts
    const offrDt = monthsAgo(i % 12)
    const saleDt = status === 'שולם' ? daysAgo(randNum(1, 60)) : null

    try {
      const [sale] = await db('sales')
        .insert({
          status,
          action: 'מכירה',
          company: deal.company,
          branch: deal.branch,
          prdct: deal.prdct,
          prdctType: deal.prdctType,
          offrDt,
          saleDt,
          clientId: rand(clientIds),
          createdById: userId,
          handlerId: userId,
          amount: deal.amount,
          cmsn,
          notes: rand(notes),
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
      if (inserted % 20 === 0) console.log(`  ${inserted}/${count}`)
    } catch (e: any) {
      console.log(`  ⚠ deal ${i + 1}: ${e.message}`)
    }
  }

  console.log(`✅ Deals seeded: ${inserted}`)
}

async function seedTasks(userId: number, clientIds: number[], count: number) {
  console.log(`\n🌱 Seeding ${count} tasks...`)
  let inserted = 0

  for (let i = 0; i < count; i++) {
    const tmpl = taskTemplates[i % taskTemplates.length]
    const completed = tmpl.status === 'הסתיים טיפול'

    try {
      await db('tasks').insert({
        clientId: rand(clientIds),
        userId,
        title: tmpl.title,
        status: tmpl.status,
        dueDate: completed ? daysAgo(randNum(1, 10)) : daysFromNow(randNum(1, 30)),
        completed,
        tasks: JSON.stringify([]) as any,
        notes: JSON.stringify([]) as any,
        files: [] as any,
      })

      inserted++
    } catch (e: any) {
      console.log(`  ⚠ task ${i + 1}: ${e.message}`)
    }
  }

  console.log(`✅ Tasks seeded: ${inserted}`)
}

async function seedPromos(userId: number, agencyId: number, count: number) {
  console.log(`\n🌱 Seeding ${count} promotions...`)
  let inserted = 0

  const promos = [
    { title: 'קמפיין Q2 — מנויים חדשים', branch: 'מנויים', target: '50000' },
    { title: 'מבצע אתרים — אפריל', branch: 'מוצרים', target: '25000' },
    { title: 'שיא חבילות H1', branch: 'חבילות', target: '100000' },
    { title: 'בונוס שירותים ניהול', branch: 'שירותים', target: '60000' },
    { title: 'קמפיין ייעוץ עסקי', branch: 'ייעוץ', target: '30000' },
    { title: 'מרתון מכירות מרץ', branch: 'שירותים', target: '80000' },
    { title: 'יעד קורסים שנתי', branch: 'קורסים', target: '20000' },
    { title: 'תחרות חבילות פרמיום', branch: 'חבילות', target: '200000' },
    { title: 'בונוס פרסום ממומן', branch: 'שירותים', target: '40000' },
    { title: 'יעד מנויים שנתי', branch: 'מנויים', target: '120000' },
    { title: 'קמפיין בניית אתרים', branch: 'מוצרים', target: '50000' },
    { title: 'מבצע ייעוץ Q3', branch: 'ייעוץ', target: '45000' },
  ]

  for (let i = 0; i < count; i++) {
    const p = promos[i % promos.length]
    const startMonth = i % 6
    try {
      await db('promo').insert({
        title: p.title,
        desc: `יעד: ${p.target}₪ ב${p.branch}. הנציג המוביל יקבל בונוס מיוחד.`,
        start: monthsAgo(startMonth + 1),
        end: daysFromNow(randNum(30, 120)),
        userIds: [userId],
        grpIds: [],
        isPromoGrp: false,
        goals: JSON.stringify({
          target: { [p.branch]: [p.target] },
          prize: ['בונוס מזומן'],
          conditions: [],
        }) as any,
        files: [] as any,
        agencyId,
      })
      inserted++
    } catch (e: any) {
      console.log(`  ⚠ promo ${i + 1}: ${e.message}`)
    }
  }

  console.log(`✅ Promos seeded: ${inserted}`)
}

// ── main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🔍 Looking up user: ${TARGET_EMAIL}`)
  const user = await db('users').where({ email: TARGET_EMAIL }).first()

  if (!user) {
    console.error(`❌ User not found: ${TARGET_EMAIL}`)
    await db.destroy()
    process.exit(1)
  }

  const { id: userId, agencyId, name } = user
  console.log(`✅ Found: ${name} (id=${userId}, agencyId=${agencyId})`)

  const leadIds = await seedLeads(userId, agencyId, 100)

  if (leadIds.length === 0) {
    console.error('❌ No leads created — stopping.')
    await db.destroy()
    process.exit(1)
  }

  await seedDeals(userId, agencyId, leadIds, 100)
  await seedTasks(userId, leadIds, 50)
  await seedPromos(userId, agencyId, 10)

  console.log('\n🎉 All done!')
  await db.destroy()
}

run().catch((e) => {
  console.error('Fatal:', e.message)
  db.destroy()
  process.exit(1)
})
