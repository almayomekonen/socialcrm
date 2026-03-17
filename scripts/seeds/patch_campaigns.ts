import { db } from '@/config/db'

// Campaign IDs seeded in seed_campaigns_social.ts
// 111 = מוצרים, 112 = שירותים, 113 = מנויים, 114 = חבילות, 115 = משוקלל

const patches = [
  {
    id: 111,
    img: 14, // חופשה מפנקת לחוף הים — matches "חופשה זוגית" prize
    goals: {
      target: { מוצרים: ['15000', '30000'] },
      prize: ['בונוס מזומן ₪3,000', 'חופשה זוגית'],
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
    id: 112,
    img: 5, // לילה תל אביב — matches "ערב גאלה" prize
    goals: {
      target: { שירותים: ['30000', '70000'] },
      prize: ['יום כיף לצוות', 'ערב גאלה + גיפט קארד ₪1,000'],
      conditions: [
        {
          branch: 'שירותים',
          prdcts: ['ניהול מדיה חברתית', 'ניהול קהילה'],
          prdctTypes: ['תשלום חודשי'],
          companies: [],
        },
      ],
    },
  },
  {
    id: 113,
    img: 16, // generic event image
    goals: {
      target: { מנויים: ['20000', '45000'] },
      prize: ['בונוס מזומן ₪2,000', 'שעון חכם + בונוס ₪3,500'],
      conditions: [
        {
          branch: 'מנויים',
          prdcts: [],
          prdctTypes: ['תשלום חודשי'],
          companies: [],
        },
      ],
    },
  },
  {
    id: 114,
    img: 3, // תאילנד — matches "טיסה + מלון" prize
    goals: {
      target: { חבילות: ['40000', '80000'] },
      prize: ['ארוחת ערב לצוות', 'טיסה + מלון לנציג המוביל'],
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
  {
    id: 115,
    img: 2, // סופש — generic reward image
    goals: {
      target: { משוקלל: ['3000', '6000'] },
      prize: ['אוזניות אלחוטיות', 'גיפט קארד ₪2,500 + אוזניות'],
      conditions: [
        {
          branch: 'משוקלל',
          prdcts: [],
          prdctTypes: [],
          companies: [],
        },
      ],
    },
  },
]

async function patch() {
  console.log('🔧 Patching campaign thresholds and images...\n')

  for (const p of patches) {
    try {
      await db('promo').where('id', p.id).update({
        img: p.img,
        goals: JSON.stringify(p.goals),
      })
      console.log(`  ✓ [${p.id}] updated — img=${p.img}, thresholds=${JSON.stringify(Object.values(p.goals.target)[0])}`)
    } catch (e: any) {
      console.log(`  ⚠ [${p.id}] failed — ${e.message}`)
    }
  }

  console.log('\n✅ Done')
  await db.destroy()
}

patch()
