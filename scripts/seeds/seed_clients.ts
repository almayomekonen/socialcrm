import { db } from '@/config/db'

// Agency & user IDs from existing DB
const AGENCY_ID = 1
const USERS = [91, 208, 219, 234, 114, 72, 86]
const rand = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)]

const leadSources = ['Instagram', 'Facebook', 'WhatsApp', 'אתר', 'המלצה', 'פרסום ממומן', 'אורגני']

const clients = [
  // Leads (lead = true)
  { firstName: 'נועה', lastName: 'לוי', idNum: '999900001', phone: '0501000001', email: 'noa.levi@gmail.com', lead: true },
  { firstName: 'אייל', lastName: 'גרינברג', idNum: '999900002', phone: '0501000002', email: 'eyal.g@gmail.com', lead: true },
  { firstName: 'שירה', lastName: 'כהן', idNum: '999900003', phone: '0501000003', email: 'shira.cohen@walla.com', lead: true },
  { firstName: 'יוסי', lastName: 'ביטון', idNum: '999900004', phone: '0501000004', email: 'yossi.biton@gmail.com', lead: true },
  { firstName: 'מיה', lastName: 'אברהם', idNum: '999900005', phone: '0501000005', email: 'mia.a@gmail.com', lead: true },
  { firstName: 'דן', lastName: 'שפירו', idNum: '999900006', phone: '0501000006', email: 'dan.shapiro@outlook.com', lead: true },
  { firstName: 'תמר', lastName: 'רוזן', idNum: '999900007', phone: '0501000007', email: 'tamar.rosen@gmail.com', lead: true },
  { firstName: 'אורן', lastName: 'מזרחי', idNum: '999900008', phone: '0501000008', email: 'oren.m@gmail.com', lead: true },

  // Clients (lead = false)
  { firstName: 'ליאת', lastName: 'אדרי', idNum: '999900009', phone: '0501000009', email: 'liat.adri@gmail.com', lead: false },
  { firstName: 'גל', lastName: 'פרידמן', idNum: '999900010', phone: '0501000010', email: 'gal.f@business.co.il', lead: false },
  { firstName: 'רון', lastName: 'אלוני', idNum: '999900011', phone: '0501000011', email: 'ron.aloni@gmail.com', lead: false },
  { firstName: 'הילה', lastName: 'שמש', idNum: '999900012', phone: '0501000012', email: 'hila.shemesh@gmail.com', lead: false },
  { firstName: 'ניר', lastName: 'דגן', idNum: '999900013', phone: '0501000013', email: 'nir.dagan@startup.io', lead: false },
  { firstName: 'דנה', lastName: 'קפלן', idNum: '999900014', phone: '0501000014', email: 'dana.kaplan@gmail.com', lead: false },
  { firstName: 'עמית', lastName: 'סגל', idNum: '999900015', phone: '0501000015', email: 'amit.segel@agency.co.il', lead: false },
  { firstName: 'יעל', lastName: 'נחום', idNum: '999900016', phone: '0501000016', email: 'yael.nachum@gmail.com', lead: false },
  { firstName: 'אסף', lastName: 'בן דוד', idNum: '999900017', phone: '0501000017', email: 'asaf.bd@gmail.com', lead: false },
  { firstName: 'מור', lastName: 'חזן', idNum: '999900018', phone: '0501000018', email: 'mor.hazan@business.com', lead: false },
  { firstName: 'נתן', lastName: 'יוסף', idNum: '999900019', phone: '0501000019', email: 'natan.y@gmail.com', lead: false },
  { firstName: 'שני', lastName: 'אלקבץ', idNum: '999900020', phone: '0501000020', email: 'shani.el@gmail.com', lead: false },
]

async function seed() {
  console.log('🌱 Seeding clients...')

  for (const c of clients) {
    try {
      await db('clients').insert({
        firstName: c.firstName,
        lastName: c.lastName,
        idNum: c.idNum,
        phone: c.phone,
        email: c.email,
        lead: c.lead,
        leadSource: rand(leadSources),
        rank: rand([1, 2, 3]),
        status: true,
        userId: rand(USERS),
        handlerId: rand(USERS),
        createdById: 91,
        agencyId: AGENCY_ID,
      })
      console.log(`  ✓ ${c.firstName} ${c.lastName} (${c.lead ? 'ליד' : 'לקוח'})`)
    } catch (e: any) {
      console.log(`  ⚠ Skipped ${c.firstName} ${c.lastName}: ${e.message}`)
    }
  }

  console.log('✅ Clients done')
  await db.destroy()
}

seed()
