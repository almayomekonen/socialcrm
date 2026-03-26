import { db } from '@/config/db'

const USER_ID = 240
const AGENCY_ID = 3

const rand = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)]

const leadSources = ['Facebook', 'Instagram', 'WhatsApp', 'המלצה', 'אורגני', 'פרסום ממומן']

const leads = [
  // Active leads (rank 1–4)
  { firstName: 'נועה', lastName: 'לוי', phone: '0521000001', email: 'noa.levi@gmail.com', rank: 1 },
  { firstName: 'אייל', lastName: 'גרינברג', phone: '0521000002', email: 'eyal.g@gmail.com', rank: 1 },
  { firstName: 'שירה', lastName: 'כהן', phone: '0521000003', email: 'shira.cohen@walla.com', rank: 2 },
  { firstName: 'יוסי', lastName: 'ביטון', phone: '0521000004', email: 'yossi.biton@gmail.com', rank: 2 },
  { firstName: 'מיה', lastName: 'אברהם', phone: '0521000005', email: 'mia.a@gmail.com', rank: 3 },
  { firstName: 'דן', lastName: 'שפירו', phone: '0521000006', email: null, rank: 3 },
  { firstName: 'תמר', lastName: 'רוזן', phone: '0521000007', email: 'tamar.rosen@gmail.com', rank: 4 },
  { firstName: 'אורן', lastName: 'מזרחי', phone: '0521000008', email: null, rank: 4 },
  { firstName: 'ליאת', lastName: 'אדרי', phone: '0521000009', email: 'liat.adri@gmail.com', rank: 1 },
  { firstName: 'גל', lastName: 'פרידמן', phone: '0521000010', email: 'gal.f@gmail.com', rank: 2 },
  { firstName: 'רון', lastName: 'אלוני', phone: '0521000011', email: null, rank: 3 },
  { firstName: 'הילה', lastName: 'שמש', phone: '0521000012', email: 'hila.shemesh@gmail.com', rank: 1 },

  // Closed leads (rank 5–6)
  { firstName: 'ניר', lastName: 'דגן', phone: '0521000013', email: 'nir.dagan@gmail.com', rank: 5 },
  { firstName: 'דנה', lastName: 'קפלן', phone: '0521000014', email: 'dana.kaplan@gmail.com', rank: 5 },
  { firstName: 'עמית', lastName: 'סגל', phone: '0521000015', email: null, rank: 6 },
  { firstName: 'יעל', lastName: 'נחום', phone: '0521000016', email: 'yael.nachum@gmail.com', rank: 5 },
  { firstName: 'אסף', lastName: 'בן דוד', phone: '0521000017', email: null, rank: 6 },
  { firstName: 'מור', lastName: 'חזן', phone: '0521000018', email: 'mor.hazan@gmail.com', rank: 5 },
]

async function seed() {
  console.log('🌱 Seeding leads for פסיקה (agency 3)...')

  for (const l of leads) {
    try {
      await db('clients').insert({
        firstName: l.firstName,
        lastName: l.lastName,
        phone: l.phone,
        email: l.email,
        rank: l.rank,
        lead: l.rank <= 4,
        leadSource: rand(leadSources),
        status: true,
        userId: USER_ID,
        handlerId: USER_ID,
        createdById: USER_ID,
        agencyId: AGENCY_ID,
      })
      console.log(`  ✓ ${l.firstName} ${l.lastName} (rank ${l.rank})`)
    } catch (e: any) {
      console.log(`  ⚠ Skipped ${l.firstName} ${l.lastName}: ${e.message}`)
    }
  }

  console.log('✅ Done!')
  await db.destroy()
}

seed()
