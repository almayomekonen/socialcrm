import { db } from '@/config/db'

const AGENCY_ID = 1
const USERS = [208, 219, 234, 114, 72, 86]
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const randNum = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const randBool = (truePct = 0.5) => Math.random() < truePct
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)
const daysFromNow = (n: number) => new Date(Date.now() + n * 864e5)

const statuses = ['הצעה נשלחה', 'ממתין לפרטים', 'תשלום ראשון התקבל', 'בטיפול', 'בבדיקה', 'הושלם', 'שולם במלואו', 'בוטל']

const completedStatuses = ['הושלם', 'שולם במלואו']

const leadSources = ['Instagram', 'Facebook', 'WhatsApp', 'אתר', 'המלצה', 'Google', 'TikTok', 'LinkedIn', 'טלפון', 'אירוע']

const noteOptions = [
  'לקוח מאוד מעוניין, לחזור בשבוע הבא',
  'ממתין לאישור מנהל',
  'שלחנו הצעה מפורטת',
  'לקוח ביקש הנחה נוספת',
  'חוזה נחתם, ממתין לתשלום',
  'שיחת מעקב בוצעה, מרוצה מהשירות',
  'לקוח ישן שחזר, להעניק מחיר מיוחד',
  'הפניה מלקוח קיים',
  'ניהול משא ומתן על תנאים',
  'נשלחה חשבונית, ממתין לאישור',
  'בקשה לשדרוג חבילה קיימת',
  'חידוש חוזה לשנה נוספת',
  null,
  null,
  null,
]

const deals = [
  // שירותים - monthly
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'Meta', amount: 3500 },
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'Meta', amount: 4200 },
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'TikTok', amount: 3800 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 2800 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1500 },
  { branch: 'שירותים', prdct: 'עיצוב גרפי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2200 },
  { branch: 'שירותים', prdct: 'עיצוב גרפי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 1800 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Google', amount: 5000 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Meta', amount: 4500 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'TikTok', amount: 3200 },
  { branch: 'שירותים', prdct: 'הפקת תוכן וידאו', prdctType: 'תשלום חד פעמי', company: 'TikTok', amount: 3800 },
  { branch: 'שירותים', prdct: 'הפקת תוכן וידאו', prdctType: 'תשלום חודשי', company: 'YouTube', amount: 6000 },
  { branch: 'שירותים', prdct: 'ניהול קהילה', prdctType: 'תשלום חודשי', company: 'Meta', amount: 2200 },
  { branch: 'שירותים', prdct: 'ניהול קהילה', prdctType: 'תשלום חודשי', company: 'TikTok', amount: 2800 },
  { branch: 'שירותים', prdct: 'אוטומציה שיווקית', prdctType: 'תשלום חודשי', company: 'HubSpot', amount: 4200 },
  { branch: 'שירותים', prdct: 'ניהול מוניטין', prdctType: 'תשלום חודשי', company: 'Google', amount: 3500 },

  // מוצרים - one-time
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'Wix', amount: 8500 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'WordPress', amount: 6500 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'React', amount: 14000 },
  { branch: 'מוצרים', prdct: 'זהות מותגית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 4800 },
  { branch: 'מוצרים', prdct: 'זהות מותגית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 6500 },
  { branch: 'מוצרים', prdct: 'חנות אונליין', prdctType: 'תשלום חד פעמי', company: 'Shopify', amount: 12000 },
  { branch: 'מוצרים', prdct: 'חנות אונליין', prdctType: 'תשלום חד פעמי', company: 'WooCommerce', amount: 9500 },
  { branch: 'מוצרים', prdct: 'אפליקציה', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 18000 },
  { branch: 'מוצרים', prdct: 'אפליקציה', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 25000 },
  { branch: 'מוצרים', prdct: 'מערכת CRM', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 15000 },

  // מנויים - monthly
  { branch: 'מנויים', prdct: 'מנוי ניהול תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 1800 },
  { branch: 'מנויים', prdct: 'מנוי ניהול תוכן', prdctType: 'תשלום חודשי', company: 'TikTok', amount: 2200 },
  { branch: 'מנויים', prdct: 'מנוי SEO', prdctType: 'תשלום חודשי', company: 'Google', amount: 2500 },
  { branch: 'מנויים', prdct: 'מנוי SEO', prdctType: 'תשלום חודשי', company: 'Google', amount: 3500 },
  { branch: 'מנויים', prdct: 'מנוי דיוור ומיילים', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 900 },
  { branch: 'מנויים', prdct: 'מנוי דיוור ומיילים', prdctType: 'תשלום חודשי', company: 'Mailchimp', amount: 1200 },
  { branch: 'מנויים', prdct: 'מנוי אנליטיקס', prdctType: 'תשלום חודשי', company: 'Google', amount: 1500 },
  { branch: 'מנויים', prdct: 'מנוי פרסום', prdctType: 'תשלום חודשי', company: 'Meta', amount: 2000 },

  // ייעוץ
  { branch: 'ייעוץ', prdct: 'ייעוץ אסטרטגי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 3000 },
  { branch: 'ייעוץ', prdct: 'ייעוץ אסטרטגי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 4500 },
  { branch: 'ייעוץ', prdct: 'ייעוץ אסטרטגי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 2000 },
  { branch: 'ייעוץ', prdct: 'ייעוץ שיווקי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2500 },
  { branch: 'ייעוץ', prdct: 'ייעוץ שיווקי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 3500 },
  { branch: 'ייעוץ', prdct: 'ליווי עסקי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3500 },
  { branch: 'ייעוץ', prdct: 'ליווי עסקי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 5000 },

  // קורסים
  { branch: 'קורסים', prdct: 'קורס פרסום ממומן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1200 },
  { branch: 'קורסים', prdct: 'קורס פרסום ממומן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1800 },
  { branch: 'קורסים', prdct: 'קורס מדיה חברתית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 980 },
  { branch: 'קורסים', prdct: 'קורס מדיה חברתית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1400 },
  { branch: 'קורסים', prdct: 'קורס בניית אתרים', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2200 },
  { branch: 'קורסים', prdct: 'קורס שיווק דיגיטלי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1600 },

  // חבילות
  { branch: 'חבילות', prdct: 'חבילת סטארטר', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3200 },
  { branch: 'חבילות', prdct: 'חבילת סטארטר', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 7500 },
  { branch: 'חבילות', prdct: 'חבילת פרו', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 5500 },
  { branch: 'חבילות', prdct: 'חבילת פרו', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 12000 },
  { branch: 'חבילות', prdct: 'חבילת אנטרפרייז', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 9800 },
  { branch: 'חבילות', prdct: 'חבילת אנטרפרייז', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 22000 },
  { branch: 'חבילות', prdct: 'חבילת מדיה', prdctType: 'תשלום חודשי', company: 'Meta', amount: 4800 },
  { branch: 'חבילות', prdct: 'חבילת גדילה', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 6500 },
]

function genContractNum() {
  return `CT-${randNum(1000, 9999)}-${randNum(100, 999)}`
}

async function seed() {
  console.log('🌱 Seeding 100 sales...')

  const clients = await db('clients').where('agencyId', AGENCY_ID).select('id', 'lead').limit(50)

  if (clients.length === 0) {
    console.log('⚠ No clients found. Run seed_clients.ts first.')
    await db.destroy()
    return
  }

  const clientIds = clients.map((c) => c.id)
  let inserted = 0

  while (inserted < 100) {
    const deal = deals[inserted % deals.length]

    try {
      const userId = rand(USERS)
      const handlerId = randBool(0.8) ? userId : rand(USERS)
      const clientId = rand(clientIds)
      const offrDt = daysAgo(randNum(0, 10))
      const status = rand(statuses)
      const isCompleted = completedStatuses.includes(status)
      const saleDt = isCompleted ? daysAgo(randNum(1, 60)) : null
      const isMonthly = deal.prdctType === 'תשלום חודשי'
      const tfuca = isMonthly ? deal.amount * 12 : deal.amount
      const cmsnRate = randNum(8, 15) / 100
      const cmsn = Math.round(tfuca * cmsnRate)
      const monthlyCmsn = isMonthly ? Math.round(cmsn / 12) : 0
      const yearlyCmsn = cmsn
      const isRenewal = randBool(0.2)
      const isUpgrade = randBool(0.15)
      const rwrd = randBool(0.1)
      const hasContract = isCompleted && randBool(0.7)
      const contractNum = hasContract ? genContractNum() : null
      const contractEndDate = hasContract ? daysFromNow(randNum(30, 365)) : null
      const notes = rand(noteOptions)
      const leadSource = rand(leadSources)
      const action = rand(['מכירה', 'ליד', 'חידוש', 'שדרוג'])

      // agency gets ~30% of cmsn, manager gets ~20%
      const agencyMonthlyCmsn = isMonthly ? Math.round(monthlyCmsn * 0.3) : 0
      const agencyYearlyCmsn = Math.round(yearlyCmsn * 0.3)
      const mngrMonthlyCmsn = isMonthly ? Math.round(monthlyCmsn * 0.2) : 0
      const mngrYearlyCmsn = Math.round(yearlyCmsn * 0.2)

      const [sale] = await db('sales')
        .insert({
          status,
          action,
          company: deal.company,
          branch: deal.branch,
          prdct: deal.prdct,
          prdctType: deal.prdctType,
          offrDt,
          saleDt,
          clientId,
          createdById: userId,
          handlerId,
          amount: deal.amount,
          cmsn,
          notes,
          polisaNum: contractNum,
          polisaEndDt: contractEndDate,
          renew: isRenewal,
          replace: isUpgrade,
          rwrd,
          leadSource,
          agencyId: AGENCY_ID,
        })
        .returning('id')

      await db('sale_users').insert({
        saleId: sale.id,
        userId,
        prcnt: 100,
        amount: deal.amount,
        cmsn,
        tfuca,
        monthlyCmsn,
        yearlyCmsn,
        agencyMonthlyCmsn,
        agencyYearlyCmsn,
        mngrMonthlyCmsn,
        mngrYearlyCmsn,
      })

      inserted++
      console.log(`  [${inserted}/100] ✓ ${deal.branch} | ${deal.prdct} | ${deal.amount}₪ | ${status}`)
    } catch (e: any) {
      console.log(`  ⚠ Skipped: ${e.message}`)
    }
  }

  console.log('✅ 100 sales done')
  await db.destroy()
}

seed()
