/**
 * Focused DEV seeder for full-height table testing (/clients and /tasks).
 *
 * Tops the test user's agency up to >=50 CLIENTS (rows in `clients` with
 * lead = false — the canonical "client" state) and >=50 TASKS visible on the
 * user's /tasks page.
 *
 * Idempotent top-up: counts current volume, inserts only the shortfall, never
 * deletes. Does NOT touch leads, deals, or schema. Scoped to one agency via EMAIL.
 *
 * Visibility guarantees (so the rows actually render):
 *  - Clients: lead=false, agencyId + userId + handlerId + createdById = test user.
 *  - Tasks: attached to clients whose createdById = user.id (the getTasks perm
 *    subquery) AND userId = user.id (the /tasks page's default filter.userId).
 *
 * Run:  npx tsx scripts/seed-fullheight-test.ts
 */

import { db } from '../config/db'

const EMAIL = 'alamayo274@gmail.com'
const TARGET_CLIENTS = 60
const TARGET_TASKS = 60

const firstNames = [
  'אבי', 'דני', 'יוסי', 'שרה', 'רחל', 'מיכאל', 'דוד', 'רות', 'חנה', 'נועה',
  'אורי', 'גיל', 'ליאור', 'תמר', 'יעל', 'איתי', 'בן', 'רון', 'עדי', 'שירה',
  'מאיה', 'נועם', 'אלון', 'עומר', 'טל', 'אופיר', 'ירון', 'הילה', 'גלית', 'קרן',
]
const lastNames = [
  'כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אזולאי', 'חדד', 'ישראלי', 'פרידמן',
  'שמש', 'אלמוג', 'דהן', 'רוזן', 'שפירו', 'קפלן', 'סגל', 'נחום',
]

// Clients are mostly "closed" (the canonical client state), with a little
// variance so the status column has something to show.
const clientStatuses = [
  'closed', 'closed', 'closed', 'closed', 'closed', 'closed',
  'closed', 'closed', 'interested', 'contacted', 'lost', 'new',
]
const leadSources = ['Instagram', 'Facebook', 'WhatsApp', 'אתר', 'המלצה', 'פרסום ממומן', 'אורגני', 'Google']
const genders = ['זכר', 'נקבה']
const familyStatuses = ['נשוי/ה', 'רווק/ה', 'גרוש/ה', 'אלמן/ה']

const taskTitles = [
  'אונבורדינג לקוח חדש', 'ניהול קמפיין ממומן - Meta', 'בניית אתר עסקי', 'דוח ביצועים חודשי',
  'הגשת הצעת מחיר', 'ניהול מדיה חברתית', 'קמפיין Google Ads', 'צילום תוכן לרשתות',
  'חידוש חוזה שנתי', 'SEO — אופטימיזציה', 'השקת ניוזלטר', 'טסט A/B לדפי נחיתה',
  'חיבור CRM ואוטומציה', 'פגישת היכרות', 'מעקב תשלום חשבונית', 'הקמת חנות Shopify',
]
const taskStatuses = [
  'פתוח', 'חדש', 'ממתין לאישור הצעה', 'ממתין לחתימת לקוח', 'בטיפול', 'הסתיים טיפול',
]

const rand = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)
const daysFromNowStr = (n: number) => new Date(Date.now() + n * 864e5).toISOString().split('T')[0]
const randomBirthDate = () => {
  const start = new Date('1965-01-01').getTime()
  const end = new Date('2003-12-31').getTime()
  return new Date(start + Math.random() * (end - start))
}

async function countClients(agencyId: number) {
  const row = await db('clients').where({ agencyId, lead: false }).count<{ count: string }>('id as count').first()
  return Number(row?.count ?? 0)
}

async function countTasks(userId: number) {
  const row = await db('tasks').where({ userId }).count<{ count: string }>('id as count').first()
  return Number(row?.count ?? 0)
}

async function topUpClients(userId: number, agencyId: number, current: number) {
  if (current >= TARGET_CLIENTS) {
    console.log(`clients already at ${current} (target ${TARGET_CLIENTS}) — no inserts`)
    return
  }
  const need = TARGET_CLIENTS - current
  const stamp = Date.now()
  console.log(`inserting ${need} clients (lead=false)…`)

  const rows = Array.from({ length: need }, (_, i) => {
    const firstName = rand(firstNames)
    const lastName = rand(lastNames)
    const ageDays = randInt(0, 180)
    const createdAt = daysAgo(ageDays)
    const statusChangedAt = daysAgo(Math.max(0, ageDays - randInt(0, Math.min(ageDays, 30))))
    const lastActivityAt = Math.random() < 0.7 ? daysAgo(randInt(0, ageDays)) : null
    // Unique phone. Distinct prefix (0507) from other seeds to avoid collisions.
    const phoneSuffix = String(stamp + i).slice(-7)
    return {
      firstName,
      lastName,
      phone: `0507${phoneSuffix}`,
      email: `${firstName}.fhclient${stamp}${i}@test.local`,
      gender: rand(genders),
      familyStatus: rand(familyStatuses),
      birthDate: randomBirthDate(),
      leadSource: `seed:fh-client:${stamp}:${i}`,
      status: rand(clientStatuses),
      rank: randInt(1, 3),
      lead: false,
      overQuota: false,
      agencyId,
      userId,
      handlerId: userId,
      createdById: userId,
      createdAt,
      updatedAt: createdAt,
      statusChangedAt,
      lastActivityAt,
    }
  })

  const inserted = await db('clients').insert(rows).returning('id')
  console.log(`inserted ${inserted.length} clients`)
}

async function topUpTasks(userId: number, agencyId: number, current: number) {
  if (current >= TARGET_TASKS) {
    console.log(`tasks already at ${current} (target ${TARGET_TASKS}) — no inserts`)
    return
  }
  const need = TARGET_TASKS - current

  // Attach to clients created by this user — satisfies the getTasks perm
  // subquery (createdById = ANY(permIds)) so the tasks render.
  const pool = await db('clients').where({ agencyId, createdById: userId }).select('id')
  if (pool.length === 0) {
    console.log('cannot insert tasks: no clients created by this user exist')
    return
  }
  const clientIds = pool.map((c: any) => Number(c.id))
  console.log(`inserting ${need} tasks across ${clientIds.length} client rows…`)

  let ok = 0
  for (let i = 0; i < need; i++) {
    const completed = Math.random() < 0.25
    const dueDate = daysFromNowStr(completed ? -randInt(1, 14) : randInt(0, 30))
    try {
      await db('tasks').insert({
        clientId: rand(clientIds),
        userId,
        title: `${rand(taskTitles)} #${i + 1}`,
        status: rand(taskStatuses),
        dueDate,
        completed,
        tasks: JSON.stringify([]) as any,
        notes: JSON.stringify([]) as any,
        files: [] as any,
      })
      ok++
    } catch (e: any) {
      console.log(`  ⚠ skipped a task: ${e.message}`)
    }
  }
  console.log(`inserted ${ok} tasks`)
}

async function run() {
  const user = await db('users').where({ email: EMAIL }).first()
  if (!user) {
    console.error(`user not found: ${EMAIL}`)
    await db.destroy()
    process.exit(1)
  }
  const agencyId: number = user.agencyId
  console.log(`user.id=${user.id} agencyId=${agencyId} email=${EMAIL}`)

  const clientsBefore = await countClients(agencyId)
  const tasksBefore = await countTasks(user.id)
  console.log(`clients before: ${clientsBefore} | tasks before: ${tasksBefore}`)

  await topUpClients(user.id, agencyId, clientsBefore)
  await topUpTasks(user.id, agencyId, tasksBefore)

  const clientsAfter = await countClients(agencyId)
  const tasksAfter = await countTasks(user.id)
  console.log('')
  console.log(`agencyId       : ${agencyId}`)
  console.log(`clients (lead=false): ${clientsBefore} → ${clientsAfter}  (target ${TARGET_CLIENTS})`)
  console.log(`tasks (userId=${user.id}): ${tasksBefore} → ${tasksAfter}  (target ${TARGET_TASKS})`)

  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
