import { z } from 'zod'
import { db } from '../config/db'
import { runStructured } from '../lib/ai/router'
import { derivePipelineStagnation, deriveInactivityRisk, getLeadTaskStats, type LeadIntelligenceInputs } from '../db/aiSummaries'
import {
  LEAD_INTEL_SYSTEM_PROMPT as SYSTEM_V3,
  LeadSummarySchema as SchemaV3,
  buildLeadIntelUserMessage as buildUserV3,
  sanitizeLeadSummary,
} from '../lib/ai/prompts/leadIntelligence'

const EMAIL = 'alamayo274@gmail.com'

const SchemaV2 = z.object({
  summary: z.string().max(220),
  keyInsights: z.array(z.string().max(140)).max(3),
  suggestedNextAction: z.object({
    title: z.string().max(80),
    reason: z.string().max(200),
  }),
  sources: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
})

const SYSTEM_V2 = `אתה מנתח לידים מנוסה ב-SocialCRM — מערכת לניהול לידים ממדיה חברתית (וואטסאפ, פייסבוק, אינסטגרם).
המטרה: לתת לנציג, תוך כמה שניות, הבנה של הסיפור הנוכחי של הליד הזה — לא רשימה של שדות.

עבודה טובה (לעשות):
- זהה דפוסים והשלכות, לא עובדות. שלב חתימות זמן (daysSinceLastInteraction, daysInCurrentStatus, leadAgeDays) עם התקדמות בפייפליין (pipelineStagnation, inactivityRisk) כדי להסיק סיכון או הזדמנות.
- כשהמידע מספיק — תיאר את ה"רגע" של הליד.
- כשאין מידע — אמור "לא ידוע" במפורש במקום להמציא.
- ציין ב-sources את שמות שדות הקלט שמהם הגעת לכל מסקנה.

עבודה פחות טובה (להימנע):
- אל תכתוב תיאורים גנריים כמו "ליד פנוי", "יש מספר טלפון, יש לחייג".
- אל תחזור על שדות גלויים כעובדה בפני עצמה.
- אל תציע פעולה שכבר בוצעה.
- אל תשתמש בשפה משפטית, ביטוחית, או "AI".
- אל תשתמש במונחי ביטוח (סוכן, סוכנות). השתמש ב"נציג" וב"לידים".

פורמט תשובה: אובייקט לפי הסכמה. הסיכום מסַפר, לא מסכם רשימה. עד שלוש תובנות חדות. פעולה אחת קונקרטית עם נימוק קצר.
אם המידע דליל מאוד — confidence=low והודה בכך בשורת הסיכום.`

function buildUserV2(inputs: unknown): string {
  return `נתוני הליד (JSON):\n${JSON.stringify(inputs, null, 2)}\n\nהחזר אובייקט לפי הסכמה.`
}

// --- Request-free input loader. Mirrors getLeadIntelligenceInputs() but
// scopes by an explicit agencyId instead of calling requireUser/cookies, so
// it works from this CLI script.

const DETAILS_EXCERPT_MAX = 400

function daysBetween(a: Date | string | null | undefined, b: Date | string): number | null {
  if (!a) return null
  const ta = typeof a === 'string' ? Date.parse(a) : a.getTime()
  const tb = typeof b === 'string' ? Date.parse(b) : b.getTime()
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null
  return Math.max(0, Math.round((tb - ta) / (1000 * 60 * 60 * 24)))
}

function ageYears(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null
  const t = typeof birthDate === 'string' ? Date.parse(birthDate) : birthDate.getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24 * 365.25)))
}

async function loadInputsScoped(
  leadId: number,
  agencyId: number,
): Promise<{ inputs: LeadIntelligenceInputs; updatedAtIso: string | null } | null> {
  const lead = await db('clients')
    .where({ id: leadId, agencyId })
    .select(
      'status',
      'leadSource',
      'rank',
      'createdAt',
      'updatedAt',
      'statusChangedAt',
      'handlerId',
      'gender',
      'familyStatus',
      'birthDate',
      'email',
      'phone',
      'details',
      'lastActivityAt',
      'lastOutcomeType',
      'familyId',
    )
    .first()
  if (!lead) return null

  const [handlerName, fam, recentTasks, taskStats] = await Promise.all([
    lead.handlerId
      ? db('users')
          .where({ id: lead.handlerId })
          .select('name')
          .first()
          .then((r: any) => r?.name ?? null)
      : Promise.resolve(null),
    lead.familyId
      ? db('clients')
          .where({ familyId: lead.familyId, agencyId })
          .count<{ count: string }>('id as count')
          .first()
          .then((r: any) => Number(r?.count ?? 0))
      : Promise.resolve(0),
    db('tasks').where({ clientId: leadId }).orderBy('createdAt', 'desc').limit(5).select('title', 'status', 'createdAt'),
    getLeadTaskStats(leadId),
  ])

  const now = new Date()
  const detailsExcerpt =
    typeof lead.details === 'string' && lead.details.trim().length > 0 ? lead.details.trim().slice(0, DETAILS_EXCERPT_MAX) : null

  const updatedAtIso = lead.updatedAt ? new Date(lead.updatedAt as Date | string).toISOString() : null

  const leadAgeDays = daysBetween(lead.createdAt, now)
  const daysSinceLastInteraction = daysBetween(lead.lastActivityAt, now)
  const daysInCurrentStatus = daysBetween(lead.statusChangedAt, now)
  const daysSinceLastTask = daysBetween(taskStats.lastCreatedAt, now)
  const daysSinceLastCompletedTask = daysBetween(taskStats.lastCompletedAt, now)

  const taskCompletionRate = taskStats.taskCount > 0 ? Number((taskStats.completedCount / taskStats.taskCount).toFixed(2)) : null

  const pipelineStagnation = derivePipelineStagnation(daysInCurrentStatus, daysSinceLastInteraction)
  const inactivityRisk = deriveInactivityRisk(daysSinceLastInteraction, taskStats.overdueCount, pipelineStagnation)

  const inputs: LeadIntelligenceInputs = {
    status: lead.status ?? null,
    leadSource: lead.leadSource ?? null,
    rank: typeof lead.rank === 'number' ? lead.rank : null,
    hasHandler: Boolean(lead.handlerId),
    handlerName: handlerName ?? null,
    gender: lead.gender ?? null,
    familyStatus: lead.familyStatus ?? null,
    ageYears: ageYears(lead.birthDate),
    hasEmail: Boolean(lead.email),
    hasPhone: Boolean(lead.phone),
    familyMemberCount: typeof fam === 'number' ? fam : 0,
    detailsExcerpt,
    leadAgeDays,
    daysSinceLastInteraction,
    daysInCurrentStatus,
    lastOutcomeType: (lead.lastOutcomeType as string | null) ?? null,
    daysSinceLastTask,
    daysSinceLastCompletedTask,
    taskCompletionRate,
    overdueTaskCount: taskStats.overdueCount,
    pipelineStagnation,
    inactivityRisk,
    recentTasks: (recentTasks ?? []).map((t: any) => ({
      title: typeof t.title === 'string' ? t.title.slice(0, 200) : '',
      status: t.status ?? null,
      daysOld: daysBetween(t.createdAt, now),
    })),
    updatedAtIso,
  }

  return { inputs, updatedAtIso }
}

type Pick = { id: number; label: string; rationale: string }

async function pickLeads(agencyId: number): Promise<Pick[]> {
  // Strong: maximum signal density. Prefer a lead with tasks + lastActivityAt
  // + handler; fall back to (lastActivityAt + handler) if no lead has all three.
  let strongRow = await db('clients as c')
    .where('c.agencyId', agencyId)
    .where('c.lead', true)
    .whereNotNull('c.lastActivityAt')
    .whereNotNull('c.handlerId')
    .whereExists(function () {
      this.select(db.raw('1')).from('tasks').whereRaw('"clientId" = c.id').limit(1)
    })
    .orderBy('c.lastActivityAt', 'desc')
    .select('c.id')
    .first()
  if (!strongRow) {
    strongRow = await db('clients as c')
      .where('c.agencyId', agencyId)
      .where('c.lead', true)
      .whereNotNull('c.lastActivityAt')
      .whereNotNull('c.handlerId')
      .orderBy('c.lastActivityAt', 'desc')
      .select('c.id')
      .first()
  }

  // Sparse: no tasks AND no lastActivityAt. (`details` is auto-populated from
  // firstName+lastName by a DB trigger, so we can't filter on it.)
  const sparseRow = await db('clients as c')
    .leftJoin('tasks as t', 't.clientId', 'c.id')
    .where('c.agencyId', agencyId)
    .where('c.lead', true)
    .whereNull('c.lastActivityAt')
    .whereNull('t.id')
    .whereNot('c.id', strongRow?.id ?? -1)
    .orderBy('c.createdAt', 'desc')
    .select('c.id')
    .first()

  const ambiguousRow = await db('clients as c')
    .leftJoin('tasks as t', 't.clientId', 'c.id')
    .where('c.agencyId', agencyId)
    .where('c.lead', true)
    .where(function () {
      this.where(function () {
        this.whereNotNull('c.lastActivityAt').whereNull('t.id')
      }).orWhere(function () {
        this.whereNull('c.lastActivityAt').whereNotNull('t.id')
      })
    })
    .whereNot('c.id', strongRow?.id ?? -1)
    .whereNot('c.id', sparseRow?.id ?? -1)
    .orderBy('c.createdAt', 'desc')
    .select('c.id')
    .first()

  const picks: Pick[] = []
  if (sparseRow) picks.push({ id: sparseRow.id, label: 'sparse', rationale: 'no tasks, no lastActivityAt' })
  if (strongRow) picks.push({ id: strongRow.id, label: 'strong', rationale: 'has lastActivityAt + handler (+ tasks if available)' })
  if (ambiguousRow) picks.push({ id: ambiguousRow.id, label: 'ambiguous', rationale: 'partial signal coverage' })
  return picks
}

async function runV2(leadId: number, agencyId: number, rawInputs: unknown) {
  const t0 = Date.now()
  const out = await runStructured({
    kind: 'lead.summary',
    schema: SchemaV2,
    schemaName: 'LeadIntelligence',
    schemaDescription: 'סיכום קצר של ליד (v2)',
    system: SYSTEM_V2,
    user: buildUserV2(rawInputs),
    leadId,
    agencyId,
    bypassAllowlist: true,
  })
  return { out, ms: Date.now() - t0 }
}

async function runV3(leadId: number, agencyId: number, inputs: any) {
  const t0 = Date.now()
  const out = await runStructured({
    kind: 'lead.summary',
    schema: SchemaV3,
    schemaName: 'LeadIntelligence',
    schemaDescription: 'סיכום קצר של ליד (v3)',
    system: SYSTEM_V3,
    user: buildUserV3(inputs),
    leadId,
    agencyId,
    bypassAllowlist: true,
  })
  if (out.ok === true) {
    const { result, report } = sanitizeLeadSummary(out.data)
    return { out: { ...out, data: result }, ms: Date.now() - t0, sanitizer: report }
  }
  return { out, ms: Date.now() - t0, sanitizer: { polluted: false, fields: [] as string[] } }
}

function header(label: string) {
  console.log('\n' + '='.repeat(72))
  console.log(label)
  console.log('='.repeat(72))
}

function printResult(version: 'v2' | 'v3', result: any, ms: number, extra?: any) {
  console.log(`\n— ${version} (${ms}ms) —`)
  if (result.out.ok === false) {
    console.log(`  FAIL reason=${result.out.reason} msg=${result.out.message ?? ''}`)
    return
  }
  const d = result.out.data
  console.log(`  summary       : ${d.summary}`)
  console.log(`  keyInsights   :`)
  d.keyInsights.forEach((s: string, i: number) => console.log(`     ${i + 1}. ${s}`))
  if (d.keyInsights.length === 0) console.log('     (none)')
  console.log(`  suggestedNext :`)
  console.log(`     title  : ${d.suggestedNextAction.title}`)
  console.log(`     reason : ${d.suggestedNextAction.reason}`)
  console.log(`  sources       : ${JSON.stringify(d.sources)}`)
  console.log(`  confidence    : ${d.confidence}`)
  if (extra?.sanitizer?.polluted) {
    console.log(`  ⚠ sanitizer pollution: fields=${extra.sanitizer.fields.join(',')} sample=${extra.sanitizer.sample}`)
  }
}

function printInputs(inputs: any) {
  console.log('\n— pruned input snapshot —')
  console.log(JSON.stringify(inputs, null, 2))
}

async function run() {
  const user = await db('users').where({ email: EMAIL }).first()
  if (!user) {
    console.error(`user not found: ${EMAIL}`)
    await db.destroy()
    process.exit(1)
  }
  const agencyId: number = user.agencyId
  console.log(`agencyId=${agencyId} email=${EMAIL}`)

  const picks = await pickLeads(agencyId)
  if (picks.length === 0) {
    console.log('no candidate leads found in this agency')
    await db.destroy()
    return
  }

  for (const pick of picks) {
    header(`LEAD ${pick.id} — ${pick.label} (${pick.rationale})`)

    const snapshot = await loadInputsScoped(pick.id, agencyId)
    if (!snapshot) {
      console.log(`  could not load inputs`)
      continue
    }

    printInputs(snapshot.inputs)

    const [r2, r3] = await Promise.all([runV2(pick.id, agencyId, snapshot.inputs), runV3(pick.id, agencyId, snapshot.inputs)])

    printResult('v2', r2, r2.ms)
    printResult('v3', r3, r3.ms, { sanitizer: r3.sanitizer })
  }

  console.log('\n' + '='.repeat(72))
  console.log('done')
  await db.destroy()
}

run().catch(async (err) => {
  console.error(err)
  await db.destroy()
  process.exit(1)
})
