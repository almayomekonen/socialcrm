import { db } from '@/config/db'

const AGENCY_ID = 1
const USERS = [208, 219, 234, 114, 72, 86]

// promo.goals structure: { target: { [branch]: [amount] }, prize: [string], conditions: [...] }
const campaigns = [
  {
    title: 'קמפיין Q2 - מנויים חדשים',
    desc: 'יעד רבעוני לגיוס לקוחות מנוי חדשים. נציג שיגיע ל-20 מנויים חדשים יזכה בבונוס.',
    start: new Date('2026-04-01'),
    end: new Date('2026-06-30'),
    userIds: [208, 219, 234],
    grpIds: [],
    isPromoGrp: false,
    goals: {
      target: { מנויים: ['50000'] },
      prize: ['בונוס מזומן 3,000₪'],
      conditions: [
        {
          branch: 'מנויים',
          prdcts: ['מנוי ניהול תוכן', 'מנוי SEO', 'מנוי אנליטיקס'],
          prdctTypes: ['תשלום חודשי'],
          companies: [],
        },
      ],
    },
  },
  {
    title: 'מבצע אתרים - אפריל',
    desc: 'קמפיין ממוקד לסגירת פרויקטי אתרים. סגירת 3 אתרים = יום חופש + גיפט קארד.',
    start: new Date('2026-04-01'),
    end: new Date('2026-04-30'),
    userIds: [114, 72, 86],
    grpIds: [],
    isPromoGrp: false,
    goals: {
      target: { מוצרים: ['25000'] },
      prize: ['יום חופש + גיפט קארד 500₪'],
      conditions: [
        {
          branch: 'מוצרים',
          prdcts: ['בניית אתר', 'חנות אונליין'],
          prdctTypes: ['תשלום חד פעמי'],
          companies: [],
        },
      ],
    },
  },
  {
    title: 'שיא חבילות - H1 2026',
    desc: 'תחרות צוותים על מכירת חבילות פרו ואנטרפרייז. הצוות המוביל זוכה בארוחת ערב.',
    start: new Date('2026-01-01'),
    end: new Date('2026-06-30'),
    userIds: [],
    grpIds: [137, 138],
    isPromoGrp: true,
    goals: {
      target: { חבילות: ['100000', '200000'] },
      prize: ['ארוחת ערב לצוות', 'ארוחת ערב + בונוס 1,500₪ לנציג'],
      conditions: [
        {
          branch: 'חבילות',
          prdcts: ['חבילת פרו', 'חבילת אנטרפרייז'],
          prdctTypes: ['תשלום חודשי', 'תשלום חד פעמי'],
          companies: [],
        },
      ],
    },
  },
]

async function seed() {
  console.log('🌱 Seeding campaigns...')

  for (const c of campaigns) {
    try {
      await db('promo').insert({
        title: c.title,
        desc: c.desc,
        start: c.start,
        end: c.end,
        userIds: c.userIds,
        grpIds: c.grpIds,
        isPromoGrp: c.isPromoGrp,
        goals: JSON.stringify(c.goals),
        agencyId: AGENCY_ID,
      })
      console.log(`  ✓ ${c.title}`)
    } catch (e: any) {
      console.log(`  ⚠ Skipped ${c.title}: ${e.message}`)
    }
  }

  console.log('✅ Campaigns done')
  await db.destroy()
}

seed()
