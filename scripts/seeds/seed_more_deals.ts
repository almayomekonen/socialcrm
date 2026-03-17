import { db } from '@/config/db'

const AGENCY_ID = 1
const USER_ID = 237 // almayo mekonen (ADMIN)
const ALL_USERS = [237, 208, 219, 234, 114, 72, 86]
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)

const statuses = [
  'הצעה נשלחה', 'ממתין לפרטים', 'תשלום ראשון התקבל',
  'בטיפול', 'בבדיקה', 'הושלם', 'שולם במלואו', 'בוטל', 'נגנז',
]

const deals = [
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'Meta', amount: 3500 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Google', amount: 5000 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1800 },
  { branch: 'שירותים', prdct: 'עיצוב גרפי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2200 },
  { branch: 'שירותים', prdct: 'הפקת תוכן וידאו', prdctType: 'תשלום חד פעמי', company: 'TikTok', amount: 4500 },
  { branch: 'שירותים', prdct: 'ניהול קהילה', prdctType: 'תשלום חודשי', company: 'Meta', amount: 2800 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Meta', amount: 3800 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'Wix', amount: 7500 },
  { branch: 'מוצרים', prdct: 'חנות אונליין', prdctType: 'תשלום חד פעמי', company: 'Shopify', amount: 11000 },
  { branch: 'מוצרים', prdct: 'זהות מותגית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 5200 },
  { branch: 'מוצרים', prdct: 'אפליקציה', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 22000 },
  { branch: 'מנויים', prdct: 'מנוי ניהול תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 1900 },
  { branch: 'מנויים', prdct: 'מנוי SEO', prdctType: 'תשלום חודשי', company: 'Google', amount: 2800 },
  { branch: 'מנויים', prdct: 'מנוי אנליטיקס', prdctType: 'תשלום חודשי', company: 'Google', amount: 1600 },
  { branch: 'מנויים', prdct: 'מנוי דיוור ומיילים', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 750 },
  { branch: 'ייעוץ', prdct: 'ייעוץ אסטרטגי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 4000 },
  { branch: 'ייעוץ', prdct: 'ליווי עסקי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3200 },
  { branch: 'ייעוץ', prdct: 'ייעוץ שיווקי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2800 },
  { branch: 'קורסים', prdct: 'קורס פרסום ממומן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1400 },
  { branch: 'קורסים', prdct: 'קורס מדיה חברתית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1100 },
  { branch: 'חבילות', prdct: 'חבילת סטארטר', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3200 },
  { branch: 'חבילות', prdct: 'חבילת פרו', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 5800 },
  { branch: 'חבילות', prdct: 'חבילת אנטרפרייז', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 9500 },
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'TikTok', amount: 4200 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'WordPress', amount: 6800 },
]

async function seed() {
  console.log('🌱 Seeding 25 more deals...')

  const clients = await db('clients')
    .where('agencyId', AGENCY_ID)
    .whereRaw('"idNum" LIKE \'9999%\'')
    .select('id')

  if (clients.length === 0) {
    console.log('⚠ No seeded clients found. Run seed_clients.ts first.')
    await db.destroy()
    return
  }

  const clientIds = clients.map((c) => c.id)

  for (const deal of deals) {
    try {
      const userId = rand(ALL_USERS)
      const clientId = rand(clientIds)
      // Spread dates over last 45 days — all in 2026
      const offrDt = daysAgo(Math.floor(Math.random() * 45))
      const status = rand(statuses)
      const isCompleted = ['הושלם', 'שולם במלואו'].includes(status)
      const saleDt = isCompleted ? daysAgo(Math.floor(Math.random() * 10)) : null
      const tfuca = deal.prdctType === 'תשלום חודשי' ? deal.amount * 12 : deal.amount
      const cmsn = Math.round(tfuca * 0.1)

      const [sale] = await db('sales').insert({
        status,
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
        leadSource: rand(['Instagram', 'Facebook', 'WhatsApp', 'אתר', 'המלצה']),
        agencyId: AGENCY_ID,
      }).returning('id')

      await db('sale_users').insert({
        saleId: sale.id,
        userId,
        prcnt: 100,
        amount: deal.amount,
        cmsn,
        tfuca,
        monthlyCmsn: deal.prdctType === 'תשלום חודשי' ? cmsn / 12 : 0,
        yearlyCmsn: cmsn,
      })

      console.log(`  ✓ ${deal.branch} | ${deal.prdct} | ${deal.amount}₪ → user ${userId}`)
    } catch (e: any) {
      console.log(`  ⚠ Skipped ${deal.prdct}: ${e.message}`)
    }
  }

  console.log('✅ 25 more deals done')
  await db.destroy()
}

seed()
