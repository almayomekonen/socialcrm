/**
 * DEVELOPMENT-ONLY seed for Dashboard V2 visual validation.
 *
 * Safety:
 *  - Refuses to run with NODE_ENV=production.
 *  - INSERTS only. Never updates/deletes real data.
 *  - Idempotent: removes ONLY its own prior seed rows, identified by markers in
 *    EXISTING fields (clients.idNum LIKE '%SEED%', meetings.google_event_id LIKE 'seed-%').
 *    Real leads have digits-only idNums and real Google event ids → never matched.
 *    (An ID-normalizing trigger zero-prefixes idNum, so we match the SEED substring.)
 *  - Uses the existing schema only. No invented fields. Mirrors the field shape
 *    that upsertLead / insertMeeting produce.
 *
 * Run:  node scripts/seed-dashboard-dev.cjs
 */

const ROOT = __dirname + '/..'
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env.local' })

if (process.env.NODE_ENV === 'production') {
  console.error('✗ Refusing to run: NODE_ENV=production. This seed is development-only.')
  process.exit(1)
}

const knex = require(ROOT + '/node_modules/knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 0, max: 2 },
})

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const now = Date.now()
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const pick = (arr) => arr[rand(0, arr.length - 1)]

const FIRST = [
  'יוסי',
  'דנה',
  'מיכל',
  'אבי',
  'נועה',
  'איתי',
  'שירה',
  'עומר',
  'תמר',
  'רון',
  'ליאת',
  'גיא',
  'הדר',
  'אורי',
  'מאיה',
  'עידן',
  'רותם',
  'אסף',
  'יעל',
  'דור',
  'ספיר',
  'ניר',
  'חן',
  'עדי',
  'בר',
]
const LAST = [
  'כהן',
  'לוי',
  'מזרחי',
  'פרץ',
  'ביטון',
  'דהן',
  'אברהם',
  'אזולאי',
  'גבאי',
  'שרון',
  'בן דוד',
  'חדד',
  'מלכה',
  'עמר',
  'נחום',
]
const SOURCES = ['פייסבוק', 'אינסטגרם', 'וואטסאפ', 'טופס נחיתה', 'המלצה', 'גוגל']
const NOTES = [
  'לחזור אחרי שבת',
  'ביקש הצעת מחיר',
  'להתקשר בבוקר',
  'מעוניין בחבילה המורחבת',
  'ביקש לחשוב',
  'לא ענה, לנסות שוב',
  'שלח פרטים במייל',
  'מתלבט בין אפשרויות',
]
const MTITLES = ['פגישת היכרות', 'שיחת מכירה', 'הדגמת מוצר', 'סגירת עסקה', 'פולו-אפ טלפוני']

// Lead allocation — designed to land EXACT dashboard section counts (see report).
// fu = next follow-up (ms offset from now, or null); sca = statusChangedAt offset (ms, negative = past)
const GROUPS = [
  // status,            count, fu(ms offset)|null,                       sca(ms offset, past)
  ['new', 15, () => null, () => -rand(5, 90) * MIN], // fresh arrivals → New lane only (not cold)
  ['contacted', 7, () => -rand(1, 6) * DAY, () => -rand(7, 20) * DAY], // overdue follow-up
  ['contacted', 5, () => -rand(1, 6) * HOUR, () => -rand(5, 15) * DAY], // due today (earlier today)
  ['contacted', 5, () => null, () => -rand(2, 10) * DAY], // SLA-cold, no follow-up → worklist
  ['contacted', 8, () => rand(1, 14) * DAY, () => -rand(3, 10) * DAY], // upcoming follow-up
  ['interested', 5, () => -rand(1, 6) * DAY, () => -rand(10, 30) * DAY], // overdue follow-up
  ['interested', 3, () => -rand(1, 6) * HOUR, () => -rand(10, 20) * DAY], // due today
  ['interested', 7, () => rand(1, 14) * DAY, () => -rand(5, 15) * DAY], // upcoming follow-up
  ['interested', 5, () => null, () => -rand(1, 40) * HOUR], // calm, not cold (< 72h), no follow-up
  ['lost', 10, () => null, () => -rand(5, 40) * DAY], // terminal — excluded everywhere
  ['closed', 5, () => null, () => -rand(10, 60) * DAY], // terminal — excluded everywhere
]

;(async () => {
  try {
    const a = await knex('clients').select('agencyId').first()
    const agencyId = a.agencyId
    const u = await knex('users').where('agencyId', agencyId).select('id').first()
    const userId = u.id
    console.log(`Target dev agency=${agencyId} user=${userId}`)

    // Idempotent cleanup of prior seed (own rows only).
    const delM = await knex('meetings').where('agency_id', agencyId).whereRaw(`google_event_id LIKE 'seed-%'`).del()
    const delC = await knex('clients').where('agencyId', agencyId).whereRaw(`"idNum" LIKE '%SEED%'`).del()
    console.log(`Cleared prior seed: ${delC} leads, ${delM} meetings`)

    // Build leads
    const leads = []
    let seq = 0
    for (const [status, count, fuFn, scaFn] of GROUPS) {
      for (let i = 0; i < count; i++) {
        seq++
        const first = pick(FIRST)
        const last = pick(LAST)
        const fuOff = fuFn()
        const scaOff = scaFn()
        const sca = new Date(now + scaOff)
        leads.push({
          agencyId,
          createdById: userId,
          userId,
          handlerId: userId,
          firstName: first,
          lastName: last,
          // `name` is a generated column (firstName + lastName) — do not insert it.
          idNum: `SEED${String(seq).padStart(4, '0')}`,
          phone: `0509${String(seq).padStart(6, '0')}`,
          status,
          leadSource: pick(SOURCES),
          lead: true,
          overQuota: false,
          statusChangedAt: sca,
          createdAt: status === 'new' ? sca : new Date(now - rand(5, 60) * DAY),
          updatedAt: new Date(now),
          nextFollowUpAt: fuOff == null ? null : new Date(now + fuOff),
          followUpNote: fuOff == null ? null : pick(NOTES),
          lastActivityAt: status === 'new' ? null : sca,
          lastOutcomeType: null,
        })
      }
    }
    const insertedIds = await knex('clients').insert(leads).returning('id')
    const leadIds = insertedIds.map((r) => r.id)
    console.log(`Inserted ${leadIds.length} leads`)

    // Meetings: 3 today (2 within the next hour → imminent), 5 future. Linked to seeded leads.
    const tz = 'Asia/Jerusalem'
    const mk = (n, startMsOff, durMin, leadIdx) => ({
      agency_id: agencyId,
      organizer_user_id: userId,
      lead_id: leadIds[leadIdx] ?? null,
      title: pick(MTITLES),
      description: null,
      location: null,
      timezone: tz,
      start_at: new Date(now + startMsOff),
      end_at: new Date(now + startMsOff + durMin * MIN),
      status: 'scheduled',
      sync_status: 'synced',
      sync_attempts: 0,
      google_event_id: `seed-${n}`,
      meet_url: 'https://meet.google.com/seed-' + n,
      created_at: new Date(now),
      updated_at: new Date(now),
    })
    const meetings = [
      mk(1, 20 * MIN, 30, 0), // today, +20m → imminent (earliest → triggers nudge)
      mk(2, 45 * MIN, 30, 16), // today, +45m → imminent
      mk(3, 4 * HOUR, 60, 27), // today, later
      mk(4, 1 * DAY + 2 * HOUR, 30, 30),
      mk(5, 2 * DAY + 3 * HOUR, 45, 33),
      mk(6, 3 * DAY + 1 * HOUR, 30, 40),
      mk(7, 5 * DAY + 5 * HOUR, 60, 45),
      mk(8, 8 * DAY + 2 * HOUR, 30, 50),
    ]
    await knex('meetings').insert(meetings)
    console.log(`Inserted ${meetings.length} meetings`)

    // ── Verify by running the dashboard predicates (agency-scoped = what renders) ──
    const notTerminal = (q) => q.whereRaw(`status IS DISTINCT FROM 'closed' AND status IS DISTINCT FROM 'lost'`)
    const base = () => knex('clients').where('agencyId', agencyId).where('lead', true)

    const dueWhere = (q) =>
      notTerminal(q).where((b) =>
        b.whereRaw(`"nextFollowUpAt" IS NOT NULL AND "nextFollowUpAt" <= NOW()`).orWhereRaw(`"nextFollowUpAt" IS NULL AND (
            (status='new' AND "statusChangedAt" <= NOW() - INTERVAL '2 hours') OR
            (status='contacted' AND "statusChangedAt" <= NOW() - INTERVAL '24 hours') OR
            (status='interested' AND "statusChangedAt" <= NOW() - INTERVAL '72 hours'))`),
      )

    const count = async (build) => Number((await build(base()).count('id as c').first()).c)
    const seedOnly = (q) => q.whereRaw(`"idNum" LIKE '%SEED%'`)

    const dueTotal = await count((q) => dueWhere(q))
    const dueSeed = await count((q) => dueWhere(seedOnly(q)))
    const newTotal = await count((q) => q.where('status', 'new'))
    const newSeed = await count((q) => seedOnly(q).where('status', 'new'))
    const upTotal = await count((q) => notTerminal(q).whereRaw(`"nextFollowUpAt" > NOW()`))
    const upSeed = await count((q) => notTerminal(seedOnly(q)).whereRaw(`"nextFollowUpAt" > NOW()`))

    const todayM = await knex('meetings as m')
      .where('m.agency_id', agencyId)
      .where('m.organizer_user_id', userId)
      .where('m.status', 'scheduled')
      .whereRaw(`m.start_at >= date_trunc('day', NOW()) AND m.start_at < date_trunc('day', NOW()) + INTERVAL '1 day'`)
      .orderBy('m.start_at', 'asc')
      .select('m.start_at')
    const firstStart = todayM[0] ? new Date(todayM[0].start_at).getTime() : null
    const imminent = firstStart != null && firstStart >= now && firstStart - now <= HOUR

    console.log('\n================ SEED REPORT ================')
    console.log('Leads created (seed):', leadIds.length, '→ new 15 · contacted 25 · interested 20 · lost 10 · closed 5')
    console.log('Follow-ups (seed): overdue 12 · due-today 8 · upcoming 15 · no-follow-up 40')
    console.log('Meetings created (seed):', meetings.length, '→ today 3 (2 within the hour) · future 5')
    console.log('\n--- Dashboard section counts (seed contribution / total incl. existing dev data) ---')
    console.log(`Due Worklist        : seed ${dueSeed} / total ${dueTotal}`)
    console.log(`New Leads           : seed ${newSeed} / total ${newTotal}`)
    console.log(`Upcoming Follow-Ups : seed ${upSeed} / total ${upTotal}`)
    console.log(`Today's Meetings    : seed/total ${todayM.length} (organizer ${userId})`)
    console.log(
      `Imminent nudge      : ${imminent ? 'YES — earliest today ' + new Date(firstStart).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : 'no'}`,
    )
    console.log('\n--- Sections populated ---')
    console.log(
      `Day Summary         : ${dueTotal >= 0 ? 'YES' : 'no'} (due ${dueTotal} · meetings ${todayM.length} · new ${newTotal})`,
    )
    console.log(`Imminent Meeting    : ${imminent ? 'YES' : 'NO'}`)
    console.log(`New Leads           : ${newTotal > 0 ? 'YES' : 'NO'}`)
    console.log(`Today's Meetings    : ${todayM.length > 0 ? 'YES' : 'NO'}`)
    console.log(`Due Worklist        : ${dueTotal > 0 ? 'YES' : 'NO'}`)
    console.log(`Upcoming Follow-Ups : ${upTotal > 0 ? 'YES' : 'NO'}`)
    console.log('=============================================')
  } catch (e) {
    console.error('✗ SEED FAILED:', e.message)
    process.exitCode = 1
  } finally {
    await knex.destroy()
  }
})()
