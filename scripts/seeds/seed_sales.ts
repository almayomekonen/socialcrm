import { db } from '@/config/db'

const AGENCY_ID = 1
const USERS = [208, 219, 234, 114, 72, 86]
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const randNum = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)

const statuses = [
  'הצעה נשלחה', 'ממתין לפרטים', 'תשלום ראשון התקבל',
  'בטיפול', 'בבדיקה', 'הושלם', 'שולם במלואו', 'בוטל',
]

const deals = [
  // שירותים - monthly
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'Meta', amount: 3500 },
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'Meta', amount: 4200 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 2800 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1500 },
  { branch: 'שירותים', prdct: 'עיצוב גרפי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2200 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Google', amount: 5000 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Meta', amount: 4500 },

  // מוצרים - one-time
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'Wix', amount: 8500 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'WordPress', amount: 6500 },
  { branch: 'מוצרים', prdct: 'זהות מותגית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 4800 },
  { branch: 'מוצרים', prdct: 'חנות אונליין', prdctType: 'תשלום חד פעמי', company: 'Shopify', amount: 12000 },

  // מנויים - monthly
  { branch: 'מנויים', prdct: 'מנוי ניהול תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 1800 },
  { branch: 'מנויים', prdct: 'מנוי SEO', prdctType: 'תשלום חודשי', company: 'Google', amount: 2500 },
  { branch: 'מנויים', prdct: 'מנוי ניהול תוכן', prdctType: 'תשלום חודשי', company: 'TikTok', amount: 2200 },
  { branch: 'מנויים', prdct: 'מנוי דיוור ומיילים', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 900 },

  // ייעוץ
  { branch: 'ייעוץ', prdct: 'ייעוץ אסטרטגי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 3000 },
  { branch: 'ייעוץ', prdct: 'ייעוץ אסטרטגי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 4500 },
  { branch: 'ייעוץ', prdct: 'ייעוץ שיווקי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2500 },

  // קורסים
  { branch: 'קורסים', prdct: 'קורס פרסום ממומן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1200 },
  { branch: 'קורסים', prdct: 'קורס מדיה חברתית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 980 },

  // חבילות
  { branch: 'חבילות', prdct: 'חבילת סטארטר', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3200 },
  { branch: 'חבילות', prdct: 'חבילת פרו', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 5500 },
  { branch: 'חבילות', prdct: 'חבילת אנטרפרייז', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 9800 },
  { branch: 'חבילות', prdct: 'חבילת סטארטר', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 7500 },

  // more שירותים
  { branch: 'שירותים', prdct: 'הפקת תוכן וידאו', prdctType: 'תשלום חד פעמי', company: 'TikTok', amount: 3800 },
  { branch: 'שירותים', prdct: 'הפקת תוכן וידאו', prdctType: 'תשלום חודשי', company: 'YouTube', amount: 6000 },
  { branch: 'שירותים', prdct: 'ניהול קהילה', prdctType: 'תשלום חודשי', company: 'Meta', amount: 2200 },
  { branch: 'מוצרים', prdct: 'אפליקציה', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 18000 },
  { branch: 'מנויים', prdct: 'מנוי אנליטיקס', prdctType: 'תשלום חודשי', company: 'Google', amount: 1500 },
  { branch: 'ייעוץ', prdct: 'ליווי עסקי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3500 },
]

async function seed() {
  console.log('🌱 Seeding sales (deals)...')

  // Get seeded client IDs
  const clients = await db('clients').where('agencyId', AGENCY_ID).whereIn('idNum',
    Array.from({ length: 20 }, (_, i) => `99990000${(i + 1).toString().padStart(1, '0')}`).map(
      (_, i) => `99990000${i + 1}`
    )
  ).select('id', 'lead')

  if (clients.length === 0) {
    console.log('⚠ No seeded clients found. Run seed_clients.ts first.')
    await db.destroy()
    return
  }

  const clientIds = clients.map((c) => c.id)

  for (const deal of deals) {
    try {
      const userId = rand(USERS)
      const clientId = rand(clientIds)
      const offrDt = daysAgo(randNum(1, 180))
      const isCompleted = ['הושלם', 'שולם במלואו'].includes(rand(statuses))
      const saleDt = isCompleted ? daysAgo(randNum(1, 30)) : null
      const tfuca = deal.prdctType === 'תשלום חודשי' ? deal.amount * 12 : deal.amount
      const cmsn = Math.round(tfuca * 0.1)

      const [sale] = await db('sales').insert({
        status: rand(statuses),
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

      console.log(`  ✓ ${deal.branch} | ${deal.prdct} | ${deal.amount}₪`)
    } catch (e: any) {
      console.log(`  ⚠ Skipped ${deal.prdct}: ${e.message}`)
    }
  }

  console.log('✅ Sales done')
  await db.destroy()
}

seed()
