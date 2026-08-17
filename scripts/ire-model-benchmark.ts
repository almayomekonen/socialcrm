/**
 * Internal IRE sales-agent comparison: classifier/policy (always) plus optional
 * live generation when OPENAI_API_KEY is present and IRE_MODEL_BENCHMARK=1.
 *
 *   IRE_MODEL_BENCHMARK=1 npx tsx scripts/ire-model-benchmark.ts
 *
 * Does not write production data. Isolates OpenAI so Anthropic/Gemini cannot
 * contaminate the gpt-4.1-mini vs gpt-5.6 comparison.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { _resetAiEnvCacheForTests } from '../lib/ai/env'
import { _resetProviderCacheForTests } from '../lib/ai/providers'
import { estimateCostUsd } from '../lib/ai/tasks'
import { formatProductKnowledgeBlock, retrieveProductKnowledge } from '../lib/inbox/autoresponse/productRetrieve'
import { classifySalesMove, classifySalesMoveFromTranscript } from '../lib/inbox/autoresponse/salesIntent'
import { decidePostGeneration } from '../lib/inbox/autoresponse/stateMachine'
import { questionPolicyForSalesMove, validateAutoResponse } from '../lib/inbox/autoresponse/validate'

const TURNS = [
  { text: 'יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים', isolated: 'PRODUCT_FIT' },
  { text: 'אני מפסיד כסף ולקוחות', isolated: 'DEEPEN' },
  { text: 'אני מפסיד כסף ולקוחות', isolated: 'DEEPEN' },
  { text: 'אחי זה לא עניינך אני צריך מערכת לניהול לידים', isolated: 'PRODUCT_FIT' },
  { text: 'איך אתה יכול לעזור לי?', isolated: 'PRODUCT_QUESTION' },
] as const

const MODELS = ['gpt-4.1-mini', 'gpt-5.6'] as const

const ENV_KEYS = new Set(['OPENAI_API_KEY', 'AI_ENABLED'])

function loadDotEnvFile(filePath: string) {
  const raw = readFileSync(filePath, 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    if (!ENV_KEYS.has(k)) continue
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v
  }
}

function loadLocalEnv() {
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '../social-crm/.env.local'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) loadDotEnvFile(p)
  }
}

function architectureScore() {
  let isolatedHits = 0
  let sequentialHits = 0
  let productHits = 0
  let handoffAtSoft = 0
  const thread: Array<{ direction: 'inbound' | 'outbound'; text: string }> = []
  const sequentialExpected = ['PRODUCT_FIT', 'PRODUCT_FIT', 'PRODUCT_FIT', 'PRODUCT_FIT', 'PRODUCT_QUESTION']
  const rows = TURNS.map((t, i) => {
    const isolated = classifySalesMove(t.text)
    if (isolated === t.isolated) isolatedHits += 1
    thread.push({ direction: 'inbound', text: t.text })
    const sequential = classifySalesMoveFromTranscript(thread)
    if (sequential === sequentialExpected[i]) sequentialHits += 1
    const pk = retrieveProductKnowledge({
      agencyId: 103,
      inboundText: t.text,
      salesMove: sequential,
      envRaw: '103',
    })
    if (sequential === 'PRODUCT_FIT' || sequential === 'PRODUCT_QUESTION') {
      if (pk.capabilities.length > 0) productHits += 1
    }
    const post = decidePostGeneration({
      hotSignal: false,
      uncertain: false,
      requiredComplete: false,
      turnCount: i,
      maxTurns: 5,
      salesMove: sequential,
    })
    if (post.action === 'escalate') handoffAtSoft += 1
    return {
      i: i + 1,
      isolated,
      sequential,
      policy: questionPolicyForSalesMove(sequential),
      pkIds: pk.capabilities.map((c) => c.id),
      post: post.action,
    }
  })
  return {
    rows,
    isolatedIntentAccuracy: isolatedHits / TURNS.length,
    sequentialIntentAccuracy: sequentialHits / TURNS.length,
    productFitOrQuestionRetrieval: productHits,
    prematureHandoffs: handoffAtSoft,
    n: TURNS.length,
  }
}

type TurnScore = {
  turn: number
  inbound: string
  salesMove: string
  reply: string | null
  ok: boolean
  error?: string
  validatorOk: boolean
  regenerated: boolean
  latencyMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  hebrew: boolean
  filler: boolean
  nameHunt: boolean
  cannedHandoff: boolean
  warmupHallucination: boolean
  productMention: boolean
  questionMarks: number
}

function scoreReply(reply: string) {
  return {
    reply,
    hebrew: /[֐-׿]/.test(reply),
    filler: /מבין שזה|זה בטח מלחיץ|מלחיץ/.test(reply),
    nameHunt: /איך קוראים|איך לפנות/.test(reply),
    cannedHandoff: /מישהו מהצוות ימשיך/.test(reply),
    warmupHallucination: /חימום יזום|הודעות חימום/.test(reply),
    productMention: /SocialCRM|לידים|וואטסאפ|פייסבוק/.test(reply),
    questionMarks: (reply.match(/\?/g) ?? []).length,
  }
}

async function runLiveModel(
  model: (typeof MODELS)[number],
  generateQualifyTurn: typeof import('../lib/inbox/autoresponse/qualify').generateQualifyTurn,
): Promise<{
  model: string
  turns: TurnScore[]
  validatorFailureRate: number
  regenerationRate: number
  avgLatencyMs: number
  totalTokens: { input: number; output: number }
  estimatedCostUsd: number
  quality: {
    hebrewRate: number
    fillerRate: number
    nameHuntRate: number
    cannedHandoffRate: number
    warmupHallucinationRate: number
    productMentionRate: number
  }
}> {
  process.env.IRE_OPENAI_MODEL = model
  if (model.startsWith('gpt-5')) process.env.IRE_OPENAI_REASONING_EFFORT = 'high'
  else delete process.env.IRE_OPENAI_REASONING_EFFORT
  _resetAiEnvCacheForTests()
  _resetProviderCacheForTests()

  const transcript: Array<{ direction: 'inbound' | 'outbound'; text: string }> = []
  const qualification: Record<string, string> = {}
  const turns: TurnScore[] = []

  for (let i = 0; i < TURNS.length; i++) {
    const inbound = TURNS[i].text
    transcript.push({ direction: 'inbound', text: inbound })
    const salesMove = classifySalesMoveFromTranscript(transcript)
    const pk = retrieveProductKnowledge({
      agencyId: 103,
      inboundText: inbound,
      salesMove,
      envRaw: '103',
    })
    const productKnowledgeBlock =
      salesMove === 'PRODUCT_QUESTION' || salesMove === 'PRODUCT_FIT' || salesMove === 'OBJECTION'
        ? formatProductKnowledgeBlock(pk)
        : null
    const questionPolicy = questionPolicyForSalesMove(salesMove)
    const genArgs = {
      agencyId: 103,
      transcript,
      qualification,
      collectFields: { required: ['name', 'need'], optional: [] as string[] },
      guidance: null as string | null,
      salesMove,
      productKnowledgeBlock,
      bypassAllowlist: true,
    }
    const started = Date.now()
    let gen = await generateQualifyTurn(genArgs)
    let regenerated = false
    let latencyMs = Date.now() - started
    if (gen.ok === false) {
      turns.push({
        turn: i + 1,
        inbound,
        salesMove,
        reply: null,
        ok: false,
        error: gen.skipReason,
        validatorOk: false,
        regenerated: false,
        latencyMs,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        hebrew: false,
        filler: false,
        nameHunt: false,
        cannedHandoff: false,
        warmupHallucination: false,
        productMention: false,
        questionMarks: 0,
      })
      continue
    }
    let validation = validateAutoResponse(gen.reply, { questionPolicy })
    if (!validation.ok) {
      regenerated = true
      const regenStarted = Date.now()
      const gen2 = await generateQualifyTurn({ ...genArgs, regenerationReason: 'shape_validation' })
      latencyMs += Date.now() - regenStarted
      if (gen2.ok) {
        gen = gen2
        validation = validateAutoResponse(gen2.reply, { questionPolicy })
      }
    }
    const reply = gen.ok ? gen.reply : ''
    const scored = scoreReply(reply)
    turns.push({
      turn: i + 1,
      inbound,
      salesMove,
      ok: gen.ok,
      validatorOk: validation.ok,
      regenerated,
      latencyMs: gen.ok ? (gen.latencyMs ?? latencyMs) : latencyMs,
      inputTokens: gen.ok ? (gen.inputTokens ?? 0) : 0,
      outputTokens: gen.ok ? (gen.outputTokens ?? 0) : 0,
      costUsd: gen.ok ? (gen.costUsd ?? estimateCostUsd(model, 0, 0)) : 0,
      ...scored,
    })
    if (gen.ok && validation.ok) transcript.push({ direction: 'outbound', text: gen.reply })
    if (gen.ok && gen.extracted.need) qualification.need = gen.extracted.need
  }

  const validatorFailureRate = turns.filter((t) => !t.validatorOk).length / turns.length
  const regenerationRate = turns.filter((t) => t.regenerated).length / turns.length
  const avgLatencyMs = Math.round(turns.reduce((s, t) => s + t.latencyMs, 0) / Math.max(turns.length, 1))
  const input = turns.reduce((s, t) => s + t.inputTokens, 0)
  const output = turns.reduce((s, t) => s + t.outputTokens, 0)
  const productTurns = turns.filter((t) => t.salesMove === 'PRODUCT_FIT' || t.salesMove === 'PRODUCT_QUESTION')
  return {
    model,
    turns,
    validatorFailureRate,
    regenerationRate,
    avgLatencyMs,
    totalTokens: { input, output },
    estimatedCostUsd: turns.reduce((s, t) => s + t.costUsd, 0),
    quality: {
      hebrewRate: turns.filter((t) => t.hebrew).length / Math.max(turns.length, 1),
      fillerRate: turns.filter((t) => t.filler).length / Math.max(turns.length, 1),
      nameHuntRate: turns.filter((t) => t.nameHunt).length / Math.max(turns.length, 1),
      cannedHandoffRate: turns.filter((t) => t.cannedHandoff).length / Math.max(turns.length, 1),
      warmupHallucinationRate: turns.filter((t) => t.warmupHallucination).length / Math.max(turns.length, 1),
      productMentionRate: productTurns.filter((t) => t.productMention).length / Math.max(productTurns.length, 1),
    },
  }
}

async function liveComparison() {
  if (process.env.IRE_MODEL_BENCHMARK !== '1') return { skipped: true as const, reason: 'IRE_MODEL_BENCHMARK!=1' }
  loadLocalEnv()
  if (!process.env.OPENAI_API_KEY) return { skipped: true as const, reason: 'no OPENAI_API_KEY' }
  process.env.AI_ENABLED = 'true'
  process.env.AI_LOG_LEVEL = 'off'
  process.env.AI_SHADOW_TELEMETRY = 'off'
  process.env.DATABASE_URL = 'postgres://ire-bench:ire-bench@127.0.0.1:5432/ire_bench'
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const { generateQualifyTurn } = await import('../lib/inbox/autoresponse/qualify')
  const results = []
  for (const model of MODELS) results.push(await runLiveModel(model, generateQualifyTurn))
  return { skipped: false as const, results }
}

async function main() {
  const arch = architectureScore()
  const sample =
    'SocialCRM מרכזת את הלידים שלך מפייסבוק, אינסטגרם ווואטסאפ במקום אחד, כך שאתה לא צריך לנהל אותם מפוזרים בין שיחות וקבצים.'
  const validatorOk = validateAutoResponse(sample, { questionPolicy: 'zero_or_one' }).ok
  const costMini = estimateCostUsd('gpt-4.1-mini', 2500, 400)
  const costSol = estimateCostUsd('gpt-5.6', 2500, 400)
  const live = await liveComparison()
  console.log(
    JSON.stringify(
      {
        architecture: {
          note: 'Sales intent, retrieval, validator, and maxTurns are deterministic and identical for both models.',
          isolatedIntentAccuracy: arch.isolatedIntentAccuracy,
          sequentialIntentAccuracy: arch.sequentialIntentAccuracy,
          productFitOrQuestionRetrieval: arch.productFitOrQuestionRetrieval,
          prematureHandoffs: arch.prematureHandoffs,
          validatorAcceptsProductAnswer: validatorOk,
          turns: arch.rows,
        },
        estimatedCostPerTurnUsd: { 'gpt-4.1-mini': costMini, 'gpt-5.6': costSol, ratio: costSol / costMini },
        liveGeneration: live,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
