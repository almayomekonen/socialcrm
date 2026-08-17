/**
 * Local REAL GPT-5.6 replay of Production conversation 578.
 * Fake WhatsApp send only. Uses local Postgres. Never Production.
 *
 *   npx tsx scripts/e2e/ire-p02-conv578-replay.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { processQualifyJob, type QualifyCtx } from '@/lib/inbox/autoresponse/qualifyWorker'
import { generateQualifyTurn } from '@/lib/inbox/autoresponse/qualify'
import { classifySalesTurnFromTranscript, isExplanationOffer } from '@/lib/inbox/autoresponse/salesIntent'
import { isProductStrategy, type SalesStrategy } from '@/lib/inbox/autoresponse/qualification'
import { retrieveProductKnowledge } from '@/lib/inbox/autoresponse/productRetrieve'
import { questionPolicyForSalesMove } from '@/lib/inbox/autoresponse/validate'
import { getMasterEnabled, setMasterEnabled, getChannelSettings } from '@/db/autoResponseSettings'
import { getAiState } from '@/db/conversationAiState'
import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { _resetAiEnvCacheForTests } from '@/lib/ai/env'
import { _resetProviderCacheForTests } from '@/lib/ai/providers'

const MARK = 'P02_E2E'
const ADVANCE_FALLBACK = 'מה הכי חשוב לך שנסדר עכשיו?'
const HANDOFF = 'מישהו מהצוות ימשיך איתך'
const INBOUNDS = [
  'יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים',
  'איך מתקדמים?',
  'וואטסאפ - ופייסבוק',
  'הוא נתקע בזה שאין מערכת שיכולה להכיל לי אותם',
  'זה בדיוק מה שאני צריך! אני מנהל את כולם דרך הוואטסאפ',
  'כן',
  'תן לי הסבר קצר על המערכת',
  'תסדר לי לידים',
] as const

type TurnReport = {
  turn: number
  inbound: string
  previousOutbound: string | null
  salesStrategyBefore: string | null
  salesStrategyAfter: string | null
  classifierSalesMove: string
  questionPolicy: string
  pkIds: string[]
  pkEnabled: boolean
  gptReply: string | null
  gptObjective: string | null
  gptSalesMove: string | null
  gptHotSignal: boolean | null
  questionCount: number
  validatorOk: boolean | null
  validatorViolation: string | null
  regeneration: boolean
  fallback: boolean
  finalResponse: string | null
  postDecision: string
  turnCountBefore: number
  turnCountAfter: number
  jobStatus: string | null
  jobSkipReason: string | null
  worker: { claimed: number; sent: number; skipped: number; failed: number }
  failReasons: string[]
}

function loadOpenAiKeyInMemory() {
  if (process.env.OPENAI_API_KEY) return
  const candidates = [
    resolve(process.cwd(), '../social-crm/.env.local'),
    resolve('/Users/User/Documents/social-crm/.env.local'),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim()
      if (!t.startsWith('OPENAI_API_KEY=')) continue
      let v = t.slice('OPENAI_API_KEY='.length).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (v) {
        process.env.OPENAI_API_KEY = v
        return
      }
    }
  }
}

function assertLocalDb() {
  const raw = process.env.DATABASE_URL ?? ''
  const u = new URL(raw)
  const host = u.hostname
  const name = (u.pathname || '').replace(/^\//, '').split('?')[0]
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`REFUSING: DATABASE_URL host is ${host}, not localhost`)
  }
  if (name === '') throw new Error('REFUSING: empty database name')
  console.log(`[P02] local db ${host}/${name}`)
}

function rawMsg(wamid: string, body: string, waid: string) {
  return { id: wamid, from: waid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }
}

function lastOutboundBeforeFinalInbound(transcript: Array<{ direction: string; text: string }>): string | null {
  let seenInbound = false
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i]
    if (!seenInbound && m.direction === 'inbound' && (m.text ?? '').trim()) {
      seenInbound = true
      continue
    }
    if (seenInbound && m.direction === 'outbound' && (m.text ?? '').trim()) return m.text
  }
  return null
}

async function loadTranscript(conversationId: number) {
  const rows = await db('inbox_messages')
    .where({ conversationId })
    .orderBy('sequence', 'asc')
    .select('direction', 'text')
  return rows
    .map((m: { direction: string; text: string | null }) => ({
      direction: m.direction as 'inbound' | 'outbound',
      text: (m.text ?? '').trim(),
    }))
    .filter((m) => m.text)
}

async function cleanup() {
  const convs: number[] = await db('inbox_conversations').where('businessPhoneNumberId', 'like', `${MARK}_%`).pluck('id')
  if (convs.length) {
    await db('auto_response_jobs').whereIn('conversationId', convs).del()
    await db('conversation_analysis_jobs').whereIn('conversationId', convs).del()
    await db('conversation_intelligence').whereIn('conversationId', convs).del()
    await db('conversation_ai_state').whereIn('conversationId', convs).del()
    await db('inbox_messages').whereIn('conversationId', convs).del()
    await db('inbox_participants').whereIn('conversationId', convs).del()
    await db('inbox_conversations').whereIn('id', convs).del()
  }
  await db('clients').where({ firstName: MARK }).del()
  await db('whatsapp_connections').where('phone_number_id', 'like', `${MARK}_%`).del()
  const qaUsers: number[] = await db('users').where('firstName', 'like', `${MARK}_owner%`).pluck('id')
  if (qaUsers.length) await db('analytics_events').whereIn('userId', qaUsers).del()
  await db('users').where('firstName', 'like', `${MARK}_owner%`).del()
}

async function main() {
  assertLocalDb()
  loadOpenAiKeyInMemory()
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing in memory (not written to disk)')
  await cleanup()

  const host = await db('users').where({ agencyId: 1 }).select('id', 'agencyId').first()
  if (!host) throw new Error('no host user in local db')
  const agencyId = Number(host.agencyId)
  const hostId = Number(host.id)
  process.env.AI_AGENCY_ALLOWLIST = String(agencyId)
  process.env.IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS = String(agencyId)
  process.env.IRE_OPENAI_MODEL = process.env.IRE_OPENAI_MODEL || 'gpt-5.6'
  process.env.IRE_OPENAI_REASONING_EFFORT = process.env.IRE_OPENAI_REASONING_EFFORT || 'high'
  process.env.AI_ENABLED = 'true'
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  _resetAiEnvCacheForTests()
  _resetProviderCacheForTests()
  console.log(`[P02] fixture agency=${agencyId} hostUser=${hostId} model=${process.env.IRE_OPENAI_MODEL}`)

  const priorMaster = await getMasterEnabled(agencyId)
  const priorSettings = await getChannelSettings(agencyId, 'whatsapp')
  const priorRow = await db('auto_response_settings').where({ agencyId, channel: 'whatsapp' }).first()

  const [owner] = await db('users')
    .insert({ firstName: `${MARK}_owner`, role: Roles.AGNT, agencyId, createdById: hostId })
    .returning('id')
  const ownerId = Number(owner.id)
  const [lead] = await db('clients')
    .insert({ firstName: MARK, lastName: 'Lead', agencyId, createdById: hostId, userId: ownerId, status: null })
    .returning('id')
  const leadId = Number(lead.id)
  const phone = `${MARK}_PHONE_${leadId}`
  const waid = `${MARK}_WA_${leadId}`
  await db('whatsapp_connections').insert({
    user_id: ownerId,
    agency_id: agencyId,
    phone_number_id: phone,
    access_token: `${MARK}_TOKEN`,
  })

  await setMasterEnabled(agencyId, true)
  if (priorRow) {
    await db('auto_response_settings').where({ agencyId, channel: 'whatsapp' }).update({
      enabled: true,
      mode: 'qualify',
      maxTurns: 8,
      delaySeconds: 0,
      draft: false,
      dailyCap: 200,
      replyMode: 'ai',
      updatedAt: db.fn.now(),
    })
  } else {
    await db('auto_response_settings').insert({
      agencyId,
      channel: 'whatsapp',
      enabled: true,
      quietHours: JSON.stringify({}),
      dailyCap: 200,
      guidance: null,
      mode: 'qualify',
      maxTurns: 8,
      delaySeconds: 0,
      draft: false,
      replyMode: 'ai',
      updatedBy: hostId,
      updatedAt: db.fn.now(),
    })
  }

  const reports: TurnReport[] = []
  let conversationId = 0
  let failed = false

  try {
    for (let i = 0; i < INBOUNDS.length; i++) {
      const inbound = INBOUNDS[i]
      const turn = i + 1
      console.log(`\n========== TURN ${turn}/8 inbound=${JSON.stringify(inbound)} ==========`)

      let salesStrategyBefore: string | null = null
      let turnCountBefore = 0
      let previousOutbound: string | null = null
      if (conversationId) {
        const aiBefore = await getAiState(conversationId)
        salesStrategyBefore = aiBefore?.qualification?.cognition?.salesStrategy ?? null
        turnCountBefore = aiBefore?.aiTurnCount ?? 0
        const existing = await loadTranscript(conversationId)
        previousOutbound = lastOutboundBeforeFinalInbound([...existing, { direction: 'inbound', text: inbound }])
      }

      const ing = await ingestWhatsappInbound({
        agencyId,
        leadId,
        businessPhoneNumberId: phone,
        customerWaId: waid,
        customerName: 'P02 QA',
        rawMessage: rawMsg(`${MARK}_IN_${turn}_${Date.now()}`, inbound, waid),
      })
      conversationId = ing.conversationId

      const transcript = await loadTranscript(conversationId)
      const classified = classifySalesTurnFromTranscript(transcript, {
        salesStrategy: (salesStrategyBefore as SalesStrategy) || undefined,
      })
      previousOutbound = lastOutboundBeforeFinalInbound(transcript)
      const pk = retrieveProductKnowledge({
        agencyId,
        inboundText: inbound,
        salesMove: classified.salesMove,
        envRaw: String(agencyId),
      })

      const traces: Array<{ stage: string; record: Record<string, unknown> }> = []
      const origLog = console.log
      console.log = (...args: unknown[]) => {
        const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
        if (line.startsWith('[WA-TRACE] ')) {
          const rest = line.slice('[WA-TRACE] '.length)
          const sp = rest.indexOf(' ')
          const stage = sp === -1 ? rest : rest.slice(0, sp)
          let record: Record<string, unknown> = {}
          try {
            record = JSON.parse(sp === -1 ? '{}' : rest.slice(sp + 1)) as Record<string, unknown>
          } catch {
            record = { raw: rest }
          }
          traces.push({ stage, record })
        }
        origLog(...args)
      }
      const genCaptures: Array<{
        reply: string | null
        objective: string | null
        salesMove: string | null
        hotSignal: boolean | null
        ok: boolean
        skipReason?: string
        regenerationReason?: string
      }> = []
      const generateQualify: typeof generateQualifyTurn = async (args) => {
        const out = await generateQualifyTurn({ ...args, bypassAllowlist: true })
        genCaptures.push({
          reply: out.ok ? out.reply : null,
          objective: out.ok ? out.objective : null,
          salesMove: out.ok ? out.salesMove : null,
          hotSignal: out.ok ? out.hotSignal : null,
          ok: out.ok,
          skipReason: out.ok === false ? out.skipReason : undefined,
          regenerationReason: args.regenerationReason,
        })
        return out
      }
      const jobRow = await db('auto_response_jobs').where({ conversationId }).orderBy('id', 'desc').first()
      if (!jobRow) throw new Error(`no job for conv ${conversationId}`)
      const settings = await getChannelSettings(agencyId, 'whatsapp')
      if (!settings) throw new Error('missing qualify settings')
      const conv = await db('inbox_conversations')
        .where({ id: conversationId })
        .first('id', 'businessPhoneNumberId', 'customerWaId', 'customerName')
      const ctx: QualifyCtx = {
        master: true,
        settings,
        conv: {
          id: conversationId,
          businessPhoneNumberId: String(conv.businessPhoneNumberId),
          customerWaId: (conv.customerWaId as string | null) ?? null,
          customerName: (conv.customerName as string | null) ?? null,
        },
        lead: { id: leadId, userId: ownerId, handlerId: null, status: null },
      }
      const send = async () => ({ ok: true as const, wamid: `${MARK}_OUT_${turn}_${Date.now()}` })
      let outcome: 'sent' | 'skipped' | 'failed' = 'failed'
      try {
        outcome = await processQualifyJob(jobRow, ctx, { send, generateQualify })
      } finally {
        console.log = origLog
      }
      const worker = {
        claimed: 1,
        sent: outcome === 'sent' ? 1 : 0,
        skipped: outcome === 'skipped' ? 1 : 0,
        failed: outcome === 'failed' ? 1 : 0,
      }

      const validationTrace = [...traces].reverse().find((t) => t.stage === 'POST_GENERATION_VALIDATION')
      const repairTrace = traces.find((t) => t.stage === 'POST_GENERATION_REPAIR')
      const validation = validationTrace?.record?.validation as { ok?: boolean; violation?: string | null } | undefined

      const job = await db('auto_response_jobs').where({ conversationId }).orderBy('id', 'desc').first()
      const aiAfter = await getAiState(conversationId)
      const lastOut = await db('inbox_messages')
        .where({ conversationId, direction: 'outbound' })
        .orderBy('sequence', 'desc')
        .first('text', 'metadata')
      const finalResponse = (lastOut?.text as string | null) ?? null
      const gpt1 = genCaptures[0]
      const gpt2 = genCaptures[1]
      const used = gpt2?.ok ? gpt2 : gpt1
      const regeneration = genCaptures.some((c) => c.regenerationReason) || Boolean(repairTrace)
      const fallback =
        (repairTrace?.record?.finalResolution === 'deterministic') ||
        (Boolean(finalResponse) && Boolean(used?.reply) && finalResponse !== used?.reply)
      const questionCount = (finalResponse?.match(/\?/g) ?? []).length
      const failReasons: string[] = []

      if (fallback) failReasons.push('deterministic fallback')
      if (worker.sent !== 1) failReasons.push(`worker.sent=${worker.sent} skipped=${worker.skipped} failed=${worker.failed}`)
      if (job?.status && job.status !== 'sent') failReasons.push(`job.status=${job.status} skip=${job.skipReason}`)
      if (!finalResponse) failReasons.push('no outbound')
      if (finalResponse?.includes(ADVANCE_FALLBACK) || used?.reply?.includes(ADVANCE_FALLBACK)) {
        failReasons.push('advance fallback occurred')
      }
      if (finalResponse?.includes(HANDOFF) || aiAfter?.aiState === 'escalated') failReasons.push('handoff')
      if (job?.skipReason === 'max_turns') failReasons.push('hard-ceiling silence')
      if (turn > 1 && classified.salesMove === 'DISCOVERY') failReasons.push('DISCOVERY loop')
      if (inbound === 'כן') {
        if (classified.salesMove === 'DISCOVERY') failReasons.push('כן classified DISCOVERY')
        if (classified.salesMove === 'DEEPEN') failReasons.push('כן classified DEEPEN')
        if (questionPolicyForSalesMove(classified.salesMove) === 'require_one') {
          failReasons.push('כן interrogates (require_one)')
        }
        const offered = Boolean(previousOutbound && isExplanationOffer(previousOutbound))
        if (offered) {
          // CASE A — explicit explanation offer + כן must enter explain.
          if (classified.salesMove !== 'PRODUCT_QUESTION') {
            failReasons.push(`כן after offer move=${classified.salesMove}`)
          }
          if (classified.salesStrategy !== 'explain') {
            failReasons.push(`כן after offer strategy=${classified.salesStrategy}`)
          }
        } else {
          // CASE B — כן after an existing product explanation continues product strategy.
          // how_it_works is the intended strategy; explain/product_fit/next_step are also valid.
          if (!isProductStrategy(classified.salesStrategy)) {
            failReasons.push(`כן after explanation strategy=${classified.salesStrategy}`)
          }
        }
      }
      if (inbound === 'תן לי הסבר קצר על המערכת') {
        if (classified.salesMove === 'DISCOVERY') failReasons.push('explain request classified DISCOVERY')
        if (classified.salesMove !== 'PRODUCT_QUESTION') {
          failReasons.push(`explain request move=${classified.salesMove}`)
        }
        if (!isProductStrategy(classified.salesStrategy)) {
          failReasons.push(`explain request strategy=${classified.salesStrategy}`)
        }
      }
      if (inbound === 'איך מתקדמים?' && classified.salesMove === 'HANDOFF_REQUEST') failReasons.push('next-step handoff move')
      if ((classified.salesMove === 'PRODUCT_QUESTION' || classified.salesMove === 'PRODUCT_FIT' || classified.salesMove === 'BUYING_SIGNAL') && !pk.capabilities.length) {
        failReasons.push('product knowledge empty on product turn')
      }

      const report: TurnReport = {
        turn,
        inbound,
        previousOutbound,
        salesStrategyBefore,
        salesStrategyAfter: aiAfter?.qualification?.cognition?.salesStrategy ?? classified.salesStrategy,
        classifierSalesMove: classified.salesMove,
        questionPolicy: questionPolicyForSalesMove(classified.salesMove),
        pkIds: pk.capabilities.map((c) => c.id),
        pkEnabled: pk.enabled,
        gptReply: used?.reply ?? null,
        gptObjective: used?.objective ?? null,
        gptSalesMove: used?.salesMove ?? null,
        gptHotSignal: used?.hotSignal ?? null,
        questionCount,
        validatorOk: validation?.ok ?? null,
        validatorViolation: validation?.violation ?? null,
        regeneration,
        fallback,
        finalResponse,
        postDecision: worker.sent === 1 ? 'send' : job?.skipReason === 'max_turns' ? 'skip:max_turns' : aiAfter?.aiState === 'escalated' ? `escalate:${aiAfter.escalationReason}` : `worker:${JSON.stringify(worker)}`,
        turnCountBefore,
        turnCountAfter: aiAfter?.aiTurnCount ?? turnCountBefore,
        jobStatus: job?.status ?? null,
        jobSkipReason: job?.skipReason ?? null,
        worker,
        failReasons,
      }
      reports.push(report)
      console.log(JSON.stringify(report, null, 2))

      if (failReasons.length) {
        failed = true
        console.error(`\nSTOP. Turn ${turn} failed: ${failReasons.join('; ')}`)
        break
      }
    }
  } finally {
    await setMasterEnabled(agencyId, priorMaster)
    if (priorRow) {
      await db('auto_response_settings').where({ agencyId, channel: 'whatsapp' }).update({
        enabled: priorRow.enabled,
        mode: priorRow.mode,
        maxTurns: priorRow.maxTurns,
        delaySeconds: priorRow.delaySeconds,
        draft: priorRow.draft,
        dailyCap: priorRow.dailyCap,
        replyMode: priorRow.replyMode,
        quietHours: priorRow.quietHours,
        guidance: priorRow.guidance,
        updatedAt: db.fn.now(),
      })
    } else if (!priorSettings) {
      await db('auto_response_settings').where({ agencyId, channel: 'whatsapp' }).del()
    }
    await cleanup()
  }

  const advanceHits = reports.filter(
    (r) => r.finalResponse?.includes(ADVANCE_FALLBACK) || r.gptReply?.includes(ADVANCE_FALLBACK),
  ).length
  const handoff = reports.some((r) => r.failReasons.includes('handoff') || r.postDecision.startsWith('escalate'))
  const ceiling = reports.some((r) => r.failReasons.includes('hard-ceiling silence'))
  const pass = !failed && reports.length === 8 && advanceHits === 0 && !handoff && !ceiling
  const reportPath = resolve('/tmp/ire-p02-conv578-replay.json')
  writeFileSync(reportPath, JSON.stringify({ pass, reports }, null, 2))
  console.log(`[P02] wrote ${reportPath}`)

  console.log('\n================ P0.2 REAL GPT-5.6 E2E ================')
  console.log(`REAL GPT-5.6 E2E: ${pass ? 'PASS' : 'FAIL'}`)
  console.log(`Turns: ${reports.length}/8`)
  console.log(`Strategy progression: ${reports.map((r) => `${r.turn}:${r.salesStrategyBefore ?? '∅'}→${r.salesStrategyAfter}`).join(' | ')}`)
  const yes = reports.find((r) => r.inbound === 'כן')
  console.log(`"כן" behavior: move=${yes?.classifierSalesMove} strategy=${yes?.salesStrategyAfter} questions=${yes?.questionCount} fallback=${yes?.fallback}`)
  const expl = reports.find((r) => r.inbound === 'תן לי הסבר קצר על המערכת')
  console.log(`Explanation behavior: move=${expl?.classifierSalesMove} strategy=${expl?.salesStrategyAfter} questions=${expl?.questionCount} fallback=${expl?.fallback}`)
  console.log(`"מה הכי חשוב לך שנסדר עכשיו?" occurrences: ${advanceHits}`)
  console.log(`Hard-ceiling silence: ${ceiling ? 'YES' : 'NO'}`)
  console.log(`Handoff: ${handoff ? 'YES' : 'NO'}`)
  console.log(`Product Knowledge: ${reports.map((r) => `${r.turn}:[${r.pkIds.join(',')}]`).join(' | ')}`)
  console.log('=======================================================')

  return pass
}

;(async () => {
  let ok = false
  try {
    ok = await main()
  } catch (e) {
    console.error('\nFATAL:', e instanceof Error ? e.stack || e.message : e)
  }
  await db.destroy()
  process.exit(ok ? 0 : 1)
})()
