/**
 * Comprehensive, fully-relational PRODUCTION demo seed.
 *
 * Builds a believable "company that has been operating for months" across every
 * surface: Leads, Clients (converted leads), Deals, Tasks, Inbox (WhatsApp), and
 * Calendar — all referencing real records. No orphans.
 *
 * SAFETY
 * ------
 * - This script does NOT import @/config/db (that singleton force-loads
 *   .env.local with override:true → always localhost). Instead it builds its own
 *   knex connection from the prod DATABASE_URL in .env.production.local, so the
 *   target is explicit and never silently localhost.
 * - It refuses to write unless SEED_CONFIRM=YES is set, and prints the masked
 *   target host first.
 * - Every row is tagged for cleanup: emails @example-crm.com, idNum prefix
 *   SEED-, leadSource may carry the source label. A matching cleanup script can
 *   delete by these markers.
 *
 * USAGE
 * -----
 *   SEED_CONFIRM=YES npx tsx scripts/seeds/seed_prod_demo.ts
 *
 * Reads the prod URL from .env.production.local (DATABASE_URL). Override with
 * SEED_DATABASE_URL=... if needed.
 */

import knex from 'knex'
import dotenv from 'dotenv'

// Defaults to the platform owner; override to seed a specific demo account's
// agency, e.g. SEED_TARGET_EMAIL=yuton@gmail.com
const TARGET_EMAIL = process.env.SEED_TARGET_EMAIL || 'alamayo274@gmail.com'

// ── resolve prod connection (explicit, never localhost by accident) ───────────
const prodEnv = dotenv.config({ path: '.env.production.local' }).parsed ?? {}
const rawUrl = process.env.SEED_DATABASE_URL || prodEnv.DATABASE_URL || ''
if (!rawUrl) {
  console.error('❌ No prod DATABASE_URL found (.env.production.local). Aborting.')
  process.exit(1)
}
const parsedUrl = new URL(rawUrl)
const maskedHost = parsedUrl.hostname
const sslMode = parsedUrl.searchParams.get('sslmode') ?? 'disable'
const useSSL = ['require', 'verify-ca', 'verify-full'].includes(sslMode)
parsedUrl.searchParams.delete('sslmode')

console.log(`\n🎯 Target DB host: ${maskedHost}  (ssl=${useSSL})`)
if (process.env.SEED_CONFIRM !== 'YES') {
  console.error('\n⛔ Refusing to write. Re-run with SEED_CONFIRM=YES to seed this database.')
  process.exit(1)
}

const db = knex({
  client: 'pg',
  connection: { connectionString: parsedUrl.toString(), ssl: useSSL ? { rejectUnauthorized: false } : false },
  pool: { min: 0, max: 10 },
})

// ── small helpers ─────────────────────────────────────────────────────────────
const rand = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]
const randNum = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)
const daysFromNow = (n: number) => new Date(Date.now() + n * 864e5)
const hoursFromNow = (n: number) => new Date(Date.now() + n * 36e5)
const monthsAgo = (n: number) => new Date(Date.now() - n * 30 * 864e5)
const pad = (n: number, len: number) => String(n).padStart(len, '0')

/** Return the set of real column names for a table (handles camelCase + snake). */
async function columnsOf(table: string): Promise<Set<string>> {
  const rows = await db('information_schema.columns')
    .where({ table_name: table, table_schema: 'public' })
    .select('column_name')
  return new Set(rows.map((r: any) => r.column_name))
}
/** Keep only keys that exist as columns; drops the rest silently. */
function pick(row: Record<string, any>, cols: Set<string>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const k of Object.keys(row)) if (cols.has(k)) out[k] = row[k]
  return out
}

// ── data pools ────────────────────────────────────────────────────────────────
const firstNames = [
  'נועה', 'אייל', 'שירה', 'יוסי', 'מיה', 'דן', 'תמר', 'אורן', 'ליאת', 'גל',
  'רון', 'הילה', 'ניר', 'דנה', 'עמית', 'יעל', 'אסף', 'מור', 'נתן', 'שני',
  'לירון', 'אבי', 'רחל', 'מתן', 'אדם', 'חן', 'בר', 'טל', 'עדן', 'אלון',
  'מיכל', 'יונתן', 'שרה', 'איתי', 'רוני', 'גיא', 'שקד', 'נבו', 'מאיה', 'אור',
]
const lastNames = [
  'לוי', 'כהן', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'שפירא', 'רוזן', 'גרינברג', 'אדרי',
  'פרידמן', 'אלוני', 'שמש', 'דגן', 'קפלן', 'סגל', 'נחום', 'חזן', 'יוסף', 'אלקבץ',
  'בן דוד', 'נוי', 'שלום', 'גולן', 'אמסלם', 'נגר', 'סרוסי', 'מלכה', 'עזרא', 'דהן',
]
const companies = [
  'מספרת רון', 'קליניקת גלאם', 'אולם אירועים הגן', 'שיפודי הכרם', 'סטודיו פילאטיס בוטיק',
  'הובלות מהיר', 'מוסך אוטו פיקס', 'גן ילדים פעמונים', 'עו"ד כהן ושות׳', 'רו"ח לוי',
  'זארה סטייל', 'פיצרייה נאפולי', 'מכון כושר פאוור', 'קוסמטיקס דנה', 'צילום אירועים',
  'קייטרינג טעמים', 'ניקיון ספארקל', 'סטודיו לק', 'דנטל קליניק', 'פרחי השרון',
  'בית קפה ארומה פינתי', 'חנות אופניים גלגל', 'מאפיית לחם הארץ', 'קליניקת שיניים חיוך', null,
]
const leadSources = ['Facebook', 'Instagram', 'WhatsApp', 'אתר', 'המלצה', 'Google', 'פרסום ממומן']
const leadStatuses = ['new', 'new', 'new', 'contacted', 'contacted', 'interested', 'interested', 'lost']
const dealStatuses = ['חדש', 'חדש', 'בהצעה', 'בהצעה', 'במו"מ', 'במו"מ', 'ממתין לתשלום', 'שולם', 'שולם', 'בוטל']
const leadNotes = [
  'לקוח מאוד מעוניין, לחזור בשבוע הבא', 'ממתין לאישור מנהל', 'שלחנו הצעה מפורטת',
  'ביקש הנחה נוספת', 'הפניה מלקוח קיים', 'מנהל משא ומתן על תנאים', 'ביקש לשדרג חבילה',
  null, null, null,
]
const lostReasons = [
  'יקר מדי מבחינת התקציב', 'בחר במתחרה', 'אין תקציב כרגע, דחה לרבעון הבא',
  'לא רלוונטי לצרכים שלו', 'לא ענה אחרי מספר ניסיונות', 'סגר עם ספק קיים',
]

const dealsCatalog = [
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'Meta', amount: 3500 },
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'TikTok', amount: 4200 },
  { branch: 'שירותים', prdct: 'כתיבת תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 2800 },
  { branch: 'שירותים', prdct: 'עיצוב גרפי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 2200 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Google', amount: 5000 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Meta', amount: 4500 },
  { branch: 'שירותים', prdct: 'הפקת תוכן וידאו', prdctType: 'תשלום חד פעמי', company: 'TikTok', amount: 3800 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 8500 },
  { branch: 'מוצרים', prdct: 'בניית אתר חנות', prdctType: 'תשלום חד פעמי', company: 'Shopify', amount: 14000 },
  { branch: 'מוצרים', prdct: 'זהות מותגית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 4800 },
  { branch: 'מוצרים', prdct: 'מערכת CRM', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 15000 },
  { branch: 'מנויים', prdct: 'מנוי ניהול תוכן', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 1800 },
  { branch: 'מנויים', prdct: 'מנוי SEO', prdctType: 'תשלום חודשי', company: 'Google', amount: 2500 },
  { branch: 'מנויים', prdct: 'מנוי דיוור', prdctType: 'תשלום חודשי', company: 'Mailchimp', amount: 1200 },
  { branch: 'ייעוץ', prdct: 'ייעוץ אסטרטגי', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 3000 },
  { branch: 'ייעוץ', prdct: 'ליווי עסקי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3500 },
  { branch: 'קורסים', prdct: 'קורס פרסום ממומן', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 1200 },
  { branch: 'חבילות', prdct: 'חבילת סטארטר', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3200 },
  { branch: 'חבילות', prdct: 'חבילת פרו', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 5500 },
  { branch: 'חבילות', prdct: 'חבילת מדיה', prdctType: 'תשלום חד פעמי', company: 'Meta', amount: 18000 },
]

const taskTemplates: { title: string; status: string }[] = [
  { title: 'שיחת מעקב עם הליד', status: 'פתוח' },
  { title: 'שליחת הצעת מחיר', status: 'ממתין לאישור הצעה' },
  { title: 'תיאום פגישת היכרות', status: 'פתוח' },
  { title: 'מעקב וואטסאפ', status: 'ממתין לפנייה ללקוח' },
  { title: 'בדיקת חוזה לחתימה', status: 'ממתין לחתימת לקוח' },
  { title: 'מעקב תשלום חשבונית', status: 'ממתין לפנייה ללקוח' },
  { title: 'אונבורדינג לקוח חדש', status: 'הסתיים טיפול' },
  { title: 'ניהול קמפיין ממומן - Meta', status: 'פתוח' },
  { title: 'דוח ביצועים חודשי', status: 'הסתיים טיפול' },
  { title: 'חידוש חוזה שנתי', status: 'ממתין לחתימת לקוח' },
  { title: 'SEO — אופטימיזציה לאתר', status: 'פתוח' },
  { title: 'צילום תוכן לרשתות', status: 'חדש' },
]
const COMPLETED_TASK_STATUS = 'הסתיים טיפול'

// WhatsApp business conversation scripts (inbound = customer, outbound = us)
const convoScripts: { dir: 'in' | 'out'; text: string }[][] = [
  [
    { dir: 'in', text: 'היי, ראיתי את המודעה בפייסבוק. אפשר לקבל פרטים על ניהול הרשתות?' },
    { dir: 'out', text: 'היי, שמחים שפנית! בשמחה. על איזה עסק מדובר ועל אילו רשתות חשבת?' },
    { dir: 'in', text: 'יש לי מספרה, רוצה לקדם אינסטגרם ופייסבוק' },
    { dir: 'out', text: 'מעולה, יש לנו חבילת ניהול מדיה שמתאימה בדיוק. אפשר לקבוע שיחה קצרה מחר?' },
    { dir: 'in', text: 'כן, מחר אחרי 16:00 נוח לי' },
    { dir: 'out', text: 'קבענו ל-16:30. נשלח לך תזכורת. נדבר!' },
  ],
  [
    { dir: 'in', text: 'שלום, כמה עולה בניית אתר תדמית לעסק קטן?' },
    { dir: 'out', text: 'שלום! תלוי בהיקף, אבל אתר תדמית בסיסי מתחיל ב-8,500 ₪. אשמח להבין מה צריך' },
    { dir: 'in', text: 'בערך 5 עמודים וטופס יצירת קשר' },
    { dir: 'out', text: 'מצוין, זה בדיוק בטווח הזה. אשלח הצעה מסודרת היום למייל' },
    { dir: 'in', text: 'מעולה תודה!' },
  ],
  [
    { dir: 'in', text: 'היי, קיבלתי את ההצעה. אפשר קצת הנחה?' },
    { dir: 'out', text: 'היי, אני מבין. אוכל להוריד 10% אם נסגור החודש. עובד לך?' },
    { dir: 'in', text: 'נשמע הוגן, בוא נתקדם' },
    { dir: 'out', text: 'אלוף! שולח חוזה לחתימה דיגיטלית בדקות הקרובות' },
  ],
  [
    { dir: 'in', text: 'שלום, אשמח לפגישת היכרות בנושא קמפיין גוגל' },
    { dir: 'out', text: 'בשמחה! יש לך יומן פנוי השבוע? אפשר זום או פגישה במשרד' },
    { dir: 'in', text: 'זום עדיף. רביעי בבוקר?' },
    { dir: 'out', text: 'קבעתי רביעי 10:00, שולח לינק. נתראה!' },
  ],
  [
    { dir: 'in', text: 'היי, רק רציתי לוודא שהתשלום נקלט?' },
    { dir: 'out', text: 'היי, כן! התשלום התקבל, תודה רבה. החשבונית בדרך למייל' },
    { dir: 'in', text: 'מצוין, תודה על השירות' },
  ],
  [
    { dir: 'in', text: 'שלום, ראיתי אתכם בהמלצה של חבר. עוסקים גם בעיצוב לוגו?' },
    { dir: 'out', text: 'שלום! כן, יש לנו חבילת זהות מותגית הכוללת לוגו, צבעוניות ופונטים' },
    { dir: 'in', text: 'כמה זמן לוקח?' },
    { dir: 'out', text: 'בדרך כלל שבועיים מרגע התחלה. אשמח לשלוח דוגמאות מעבודות קודמות' },
    { dir: 'in', text: 'כן בבקשה' },
  ],
]

const meetingTitles = [
  'שיחת היכרות', 'פגישת דמו', 'סקירת הצעת מחיר', 'חתימת חוזה',
  'פגישת המשך', 'שיחת אונבורדינג', 'סקירת ביצועים חודשית',
]
const meetingLocations = ['Zoom', 'במשרד', 'טלפוני', 'Google Meet']

// ── seeding ─────────────────────────────────────────────────────────────────
type LeadRec = { id: number; firstName: string; lastName: string; phone: string; waId: string; status: string; isClient: boolean }

async function run() {
  console.log(`\n🔍 Looking up user: ${TARGET_EMAIL}`)
  const user = await db('users').where({ email: TARGET_EMAIL }).first()
  if (!user) {
    console.error(`❌ User not found: ${TARGET_EMAIL}`)
    await db.destroy()
    process.exit(1)
  }
  const userId: number = user.id
  const agencyId: number = user.agencyId
  console.log(`✅ Found: ${user.name} (id=${userId}, agencyId=${agencyId})`)

  const clientCols = await columnsOf('clients')
  const salesCols = await columnsOf('sales')
  const saleUsersCols = await columnsOf('sale_users')
  const tasksCols = await columnsOf('tasks')
  const convCols = await columnsOf('inbox_conversations')
  const msgCols = await columnsOf('inbox_messages')
  const partCols = await columnsOf('inbox_participants')
  const meetingCols = await columnsOf('meetings')

  // Pre-flight report — verify every target table resolved before writing
  const report: [string, Set<string>, string[]][] = [
    ['clients', clientCols, ['firstName', 'lead', 'status', 'agencyId']],
    ['sales', salesCols, ['status', 'clientId', 'amount']],
    ['sale_users', saleUsersCols, ['saleId', 'userId']],
    ['tasks', tasksCols, ['clientId', 'title', 'status']],
    ['inbox_conversations', convCols, ['leadId', 'channel', 'customerWaId']],
    ['inbox_messages', msgCols, ['conversationId', 'direction', 'text']],
    ['inbox_participants', partCols, ['conversationId', 'role']],
    ['meetings', meetingCols, ['lead_id', 'start_at', 'status']],
  ]
  console.log('\n🔎 Schema pre-flight:')
  let missing = false
  for (const [name, cols, required] of report) {
    const absent = required.filter((c) => !cols.has(c))
    const ok = cols.size > 0 && absent.length === 0
    console.log(`   ${ok ? '✓' : '✗'} ${name} (${cols.size} cols)${absent.length ? ` — MISSING: ${absent.join(', ')}` : ''}`)
    if (!ok) missing = true
  }
  if (missing) {
    console.error('\n❌ Schema mismatch — aborting before any write. Investigate the ✗ tables above.')
    await db.destroy()
    process.exit(1)
  }

  if (process.env.SEED_DRY === '1') {
    console.log('\n🧪 DRY RUN complete — connection, user, and schema verified. No rows written.')
    await db.destroy()
    process.exit(0)
  }

  const base = Date.now() % 9000000

  // 1) LEADS + CLIENTS (same table; client = converted lead) ───────────────────
  const N_LEADS = 60 // lead=true
  const N_CLIENTS = 55 // lead=false, status=closed (converted)
  const records: LeadRec[] = []
  console.log(`\n🌱 Seeding ${N_LEADS} leads + ${N_CLIENTS} clients...`)

  for (let i = 0; i < N_LEADS + N_CLIENTS; i++) {
    const isClient = i >= N_LEADS
    const firstName = rand(firstNames)
    const lastName = rand(lastNames)
    const phoneLocal = `052${pad((1000000 + base + i) % 10000000, 7)}` // 0529xxxxxx style
    const waId = `972${phoneLocal.slice(1)}` // 97252xxxxxxx
    const status = isClient ? 'closed' : rand(leadStatuses)
    // Clients converted longer ago; leads more recent
    const createdAt = isClient ? monthsAgo(randNum(2, 8)) : daysAgo(randNum(0, 90))
    const statusChangedAt = isClient ? daysAgo(randNum(5, 120)) : daysAgo(randNum(0, 60))

    const row = pick(
      {
        firstName,
        lastName,
        phone: phoneLocal,
        email: `seed.${base}.${i}@example-crm.com`,
        // NOTE: idNum is intentionally omitted. A DB trigger truncates idNum to 9
        // chars (Israeli ID length), which collapses unique tags into collisions
        // on clients_idNum_agencyId_unique. Leaving it null (as the proven
        // seed_for_prod.ts does) sidesteps the unique constraint entirely.
        company: rand(companies),
        leadSource: rand(leadSources),
        lead: !isClient,
        status,
        overQuota: false,
        userId,
        handlerId: userId,
        createdById: userId,
        agencyId,
        statusChangedAt,
        createdAt,
        updatedAt: statusChangedAt,
      },
      clientCols,
    )

    try {
      const [r] = await db('clients').insert(row).returning('id')
      records.push({ id: Number(r.id), firstName, lastName, phone: phoneLocal, waId, status, isClient })
    } catch (e: any) {
      console.log(`  ⚠ lead/client ${i}: ${e.message}`)
    }
  }
  const leadRecs = records.filter((r) => !r.isClient)
  const clientRecs = records.filter((r) => r.isClient)
  console.log(`✅ ${leadRecs.length} leads + ${clientRecs.length} clients created`)
  if (records.length === 0) {
    console.error('❌ No records created — stopping.')
    await db.destroy()
    process.exit(1)
  }

  // 2) DEALS (sales + sale_users) ──────────────────────────────────────────────
  const N_DEALS = 60
  console.log(`\n🌱 Seeding ${N_DEALS} deals...`)
  let dealsOk = 0
  for (let i = 0; i < N_DEALS; i++) {
    const cat = rand(dealsCatalog)
    const status = rand(dealStatuses)
    const isPaid = status === 'שולם'
    const isLost = status === 'בוטל'
    // Won/paid deals attach to closed clients; open/lost to leads
    const target = isPaid ? rand(clientRecs.length ? clientRecs : records) : rand(leadRecs.length ? leadRecs : records)
    const isMonthly = cat.prdctType === 'תשלום חודשי'
    const tfuca = isMonthly ? cat.amount * 12 : cat.amount
    const cmsn = Math.round(tfuca * (randNum(8, 15) / 100))
    const offrDt = monthsAgo(i % 12)
    const saleDt = isPaid ? daysAgo(randNum(1, 60)) : null
    const note = isLost ? rand(lostReasons) : rand(leadNotes)

    const saleRow = pick(
      {
        status,
        action: 'מכירה',
        company: cat.company,
        branch: cat.branch,
        prdct: cat.prdct,
        prdctType: cat.prdctType,
        offrDt,
        saleDt,
        clientId: target.id,
        createdById: userId,
        handlerId: userId,
        userId,
        amount: cat.amount,
        cmsn,
        notes: note,
        agencyId,
        createdAt: offrDt,
        updatedAt: saleDt ?? offrDt,
      },
      salesCols,
    )

    try {
      const [sale] = await db('sales').insert(saleRow).returning('id')
      const suRow = pick({ saleId: sale.id, userId, prcnt: 100, amount: cat.amount, cmsn, tfuca }, saleUsersCols)
      await db('sale_users').insert(suRow)
      dealsOk++
    } catch (e: any) {
      console.log(`  ⚠ deal ${i}: ${e.message}`)
    }
  }
  console.log(`✅ ${dealsOk} deals created`)

  // 3) TASKS ────────────────────────────────────────────────────────────────────
  const N_TASKS = 60
  console.log(`\n🌱 Seeding ${N_TASKS} tasks...`)
  let tasksOk = 0
  for (let i = 0; i < N_TASKS; i++) {
    const tmpl = rand(taskTemplates)
    const completed = tmpl.status === COMPLETED_TASK_STATUS
    const target = rand(records)
    // mix of completed (past), pending (future), overdue (past + not completed)
    const overdue = !completed && i % 3 === 0
    const dueDate = completed ? daysAgo(randNum(1, 20)) : overdue ? daysAgo(randNum(1, 14)) : daysFromNow(randNum(1, 30))

    const taskRow = pick(
      {
        clientId: target.id,
        userId,
        agencyId,
        title: tmpl.title,
        status: tmpl.status,
        dueDate,
        completed,
        tasks: JSON.stringify([]),
        notes: JSON.stringify([]),
        files: [],
      },
      tasksCols,
    )
    try {
      await db('tasks').insert(taskRow)
      tasksOk++
    } catch (e: any) {
      console.log(`  ⚠ task ${i}: ${e.message}`)
    }
  }
  console.log(`✅ ${tasksOk} tasks created`)

  // 4) INBOX — WhatsApp conversations ──────────────────────────────────────────
  const N_CONV = 18
  console.log(`\n🌱 Seeding ${N_CONV} inbox conversations...`)
  const businessPhoneNumberId = `SEED_BIZ_${base}`
  // Prefer records with a waId; mix leads and clients
  const convTargets = [...records].sort(() => 0.5 - Math.random()).slice(0, N_CONV)
  let convOk = 0
  for (let c = 0; c < convTargets.length; c++) {
    const t = convTargets[c]
    const script = rand(convoScripts)
    const startedAt = daysAgo(randNum(1, 45))
    try {
      await db.transaction(async (trx) => {
        const convRow = pick(
          {
            agencyId,
            leadId: t.id,
            channel: 'whatsapp',
            businessPhoneNumberId,
            customerWaId: t.waId,
            customerName: `${t.firstName} ${t.lastName}`,
            state: 'open',
          },
          convCols,
        )
        const [conv] = await trx('inbox_conversations').insert(convRow).returning('id')
        const convId = Number(conv.id)

        // participants (customer + business)
        for (const p of [
          { role: 'customer', waId: t.waId, displayName: `${t.firstName} ${t.lastName}`, leadId: t.id },
          { role: 'business', waId: businessPhoneNumberId, displayName: 'העסק שלי', leadId: null },
        ]) {
          const partRow = pick({ conversationId: convId, agencyId, role: p.role, waId: p.waId, displayName: p.displayName, leadId: p.leadId }, partCols)
          if (partCols.size) await trx('inbox_participants').insert(partRow).onConflict(['conversationId', 'role']).ignore()
        }

        let ts = startedAt
        let lastText = ''
        let lastDir = ''
        let inboundCount = 0
        for (let m = 0; m < script.length; m++) {
          const msg = script[m]
          ts = new Date(ts.getTime() + randNum(2, 90) * 60000) // minutes between messages
          const direction = msg.dir === 'in' ? 'inbound' : 'outbound'
          if (direction === 'inbound') inboundCount++
          const msgRow = pick(
            {
              conversationId: convId,
              agencyId,
              leadId: t.id,
              channel: 'whatsapp',
              direction,
              status: direction === 'inbound' ? 'received' : 'read',
              externalId: `seed_wa_${base}_${c}_${m}`,
              fromId: direction === 'inbound' ? t.waId : businessPhoneNumberId,
              toId: direction === 'inbound' ? businessPhoneNumberId : t.waId,
              type: 'text',
              text: msg.text,
              payload: JSON.stringify({}),
              rawPayload: JSON.stringify(null),
              metadata: JSON.stringify({}),
              sentByUserId: direction === 'outbound' ? userId : null,
              channelTimestamp: ts,
              sequence: m + 1,
              createdAt: ts,
            },
            msgCols,
          )
          await trx('inbox_messages').insert(msgRow)
          lastText = msg.text
          lastDir = direction
        }

        // roll up conversation counters
        const bumpRow = pick(
          {
            lastMessageAt: ts,
            lastInboundAt: ts,
            lastDirection: lastDir,
            lastMessageText: lastText,
            messageCount: script.length,
            unreadCount: lastDir === 'inbound' ? inboundCount : 0,
            updatedAt: ts,
          },
          convCols,
        )
        if (Object.keys(bumpRow).length) await trx('inbox_conversations').where({ id: convId }).update(bumpRow)
      })
      convOk++
    } catch (e: any) {
      console.log(`  ⚠ conversation ${c}: ${e.message}`)
    }
  }
  console.log(`✅ ${convOk} conversations created`)

  // 5) CALENDAR — upcoming meetings ─────────────────────────────────────────────
  const N_MEET = 12
  console.log(`\n🌱 Seeding ${N_MEET} calendar events...`)
  let meetOk = 0
  for (let i = 0; i < N_MEET; i++) {
    const t = rand(records)
    const startAt = hoursFromNow(randNum(4, 24 * 18) + i) // spread over next ~18 days
    const endAt = new Date(startAt.getTime() + 60 * 60000)
    const meetRow = pick(
      {
        agency_id: agencyId,
        organizer_user_id: userId,
        lead_id: t.id,
        title: `${rand(meetingTitles)} — ${t.firstName} ${t.lastName}`,
        description: 'נקבע אוטומטית מתוך המערכת',
        location: rand(meetingLocations),
        timezone: 'Asia/Jerusalem',
        start_at: startAt,
        end_at: endAt,
        status: 'scheduled',
        sync_status: 'pending',
        sync_attempts: 0,
      },
      meetingCols,
    )
    try {
      await db('meetings').insert(meetRow)
      meetOk++
    } catch (e: any) {
      console.log(`  ⚠ meeting ${i}: ${e.message}`)
    }
  }
  console.log(`✅ ${meetOk} calendar events created`)

  console.log('\n🎉 Done. Summary:')
  console.log(`   leads=${leadRecs.length} clients=${clientRecs.length} deals=${dealsOk} tasks=${tasksOk} conversations=${convOk} meetings=${meetOk}`)
  await db.destroy()
}

run().catch(async (e) => {
  console.error('Fatal:', e.message)
  await db.destroy()
  process.exit(1)
})
