import { db } from '@/config/db'

const AGENCY_ID = 1

// All active AGNT + MNGR user IDs (agencyId = 1, not suspended)
const ALL_REPS = [
  // AGNT
  21, 229, 219, 39, 10, 9, 144, 11, 73, 141, 46, 36, 114, 189, 8, 31, 16, 143,
  29, 145, 30, 121, 76, 215, 209, 226, 113, 19, 175, 41, 45, 216, 80, 47, 122,
  129, 79, 222, 22, 85, 32, 83, 208, 65, 223, 48, 64, 81, 66, 56, 57, 78, 234,
  17, 224, 37, 42, 25, 169, 231, 118, 116, 35, 63, 27, 72, 40, 49, 228, 50, 210,
  120, 157, 67, 161, 15, 62, 68, 59, 220, 74, 18, 176, 147, 117, 155, 227, 43,
  128, 127, 142, 174, 69, 28, 44, 158, 24, 51, 238,
  // MNGR
  70, 4, 112, 14, 12, 60, 20, 23, 115, 34, 54, 5, 33,
]

const campaigns = [
  // ─────────────────────────────────────────────
  // 1. בניית אתרים
  // ─────────────────────────────────────────────
  {
    title: 'קמפיין בניית אתרים - Q2 2026',
    desc: 'יעד רבעוני לסגירת פרויקטי בניית אתרים. נציג שיגיע ל-₪120,000 יזכה בבונוס מזומן, מי שיגיע ל-₪200,000 יזכה בחופשה זוגית.',
    start: new Date('2026-04-01'),
    end: new Date('2026-06-30'),
    userIds: ALL_REPS,
    grpIds: [],
    isPromoGrp: false,
    goals: {
      target: { מוצרים: ['120000', '200000'] },
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

  // ─────────────────────────────────────────────
  // 2. ניהול מדיה חברתית
  // ─────────────────────────────────────────────
  {
    title: 'קמפיין ניהול מדיה - אפריל 2026',
    desc: 'מבצע חודשי על חוזי ניהול מדיה חברתית חדשים. יעד ₪40,000 — יום כיף לצוות. יעד ₪80,000 — ערב גאלה + פרס אישי.',
    start: new Date('2026-04-01'),
    end: new Date('2026-04-30'),
    userIds: ALL_REPS,
    grpIds: [],
    isPromoGrp: false,
    goals: {
      target: { שירותים: ['40000', '80000'] },
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

  // ─────────────────────────────────────────────
  // 3. מנויים חדשים
  // ─────────────────────────────────────────────
  {
    title: 'קמפיין מנויים - H1 2026',
    desc: 'יעד חצי שנתי לגיוס מנויים חודשיים. כל מנוי חדש שנסגר נחשב. נציג שיגיע ל-₪50,000 בהכנסות מנויים יזכה בבונוס.',
    start: new Date('2026-01-01'),
    end: new Date('2026-06-30'),
    userIds: ALL_REPS,
    grpIds: [],
    isPromoGrp: false,
    goals: {
      target: { מנויים: ['50000', '100000'] },
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

  // ─────────────────────────────────────────────
  // 4. חבילות פרימיום
  // ─────────────────────────────────────────────
  {
    title: 'קמפיין חבילות פרימיום - Q2 2026',
    desc: 'מכירת חבילות פרו ואנטרפרייז. יעד ₪60,000 — ארוחת ערב לצוות. יעד ₪120,000 — טיול לחו"ל לנציג המוביל.',
    start: new Date('2026-04-01'),
    end: new Date('2026-06-30'),
    userIds: ALL_REPS,
    grpIds: [],
    isPromoGrp: false,
    goals: {
      target: { חבילות: ['60000', '120000'] },
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

  // ─────────────────────────────────────────────
  // 5. ייעוץ וליווי — משוקלל (עמלה כוללת)
  // ─────────────────────────────────────────────
  {
    title: 'תחרות עמלות - מרץ 2026',
    desc: 'תחרות חודשית על סך העמלות הכולל. הנציג עם הסכום הגבוה ביותר בחודש מרץ מקבל פרס.',
    start: new Date('2026-03-01'),
    end: new Date('2026-03-31'),
    userIds: ALL_REPS,
    grpIds: [],
    isPromoGrp: false,
    goals: {
      target: { משוקלל: ['10000', '25000'] },
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

async function seed() {
  console.log('🧹 Deleting all existing campaigns...')
  const deleted = await db('promo').where('agencyId', AGENCY_ID).delete()
  console.log(`  ✓ Deleted ${deleted} campaigns`)

  console.log('\n🌱 Seeding SocialCRM campaigns...')

  for (const c of campaigns) {
    try {
      const [row] = await db('promo')
        .insert({
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
        .returning('id')

      console.log(`  ✓ [${row.id}] ${c.title}`)
    } catch (e: any) {
      console.log(`  ⚠ Failed: ${c.title} — ${e.message}`)
    }
  }

  console.log('\n✅ SocialCRM campaigns seeded successfully')
  await db.destroy()
}

seed()
