import { db } from '../config/db'

const EMAIL = 'alamayo274@gmail.com'
const COUNT = 27

const firstNames = [
  'אבי', 'דני', 'יוסי', 'שרה', 'רחל', 'מיכאל', 'דוד', 'רות', 'חנה',
  'נועה', 'אורי', 'גיל', 'ליאור', 'תמר', 'יעל', 'איתי', 'בן', 'רון',
  'עדי', 'שירה', 'מאיה', 'נועם', 'אלון', 'עומר', 'טל', 'אופיר', 'ירון',
]
const lastNames = [
  'כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אזולאי', 'חדד', 'ישראלי',
  'פרידמן', 'שמש', 'אלמוג', 'דהן', 'ברקוביץ', 'גולדשטיין',
]

async function run() {
  const user = await db('users').where({ email: EMAIL }).first()
  if (!user) {
    console.error(`❌ User not found: ${EMAIL}`)
    await db.destroy()
    process.exit(1)
  }

  console.log(`Found user id=${user.id} agencyId=${user.agencyId}`)

  const beforeRow = await db('clients').where({ agencyId: user.agencyId }).count<{ count: string }>('id as count').first()
  const before = Number(beforeRow?.count ?? 0)
  console.log(`Current leads for agency: ${before}`)

  const now = new Date()
  const stamp = now.getTime()

  const rows = Array.from({ length: COUNT }, (_, i) => ({
    firstName: firstNames[i % firstNames.length],
    lastName: lastNames[i % lastNames.length],
    phone: `97250${String(stamp).slice(-7)}${String(i).padStart(2, '0')}`.slice(0, 12),
    agencyId: user.agencyId,
    userId: user.id,
    handlerId: user.id,
    createdById: user.id,
    lead: true,
    status: 'new',
    overQuota: false,
    leadSource: `seed:test:${stamp}:${i}`,
    statusChangedAt: now,
  }))

  const inserted = await db('clients').insert(rows).returning('id')
  console.log(`✅ Inserted ${inserted.length} leads`)

  const afterRow = await db('clients').where({ agencyId: user.agencyId }).count<{ count: string }>('id as count').first()
  const after = Number(afterRow?.count ?? 0)
  console.log(`Final leads for agency: ${after}`)

  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
