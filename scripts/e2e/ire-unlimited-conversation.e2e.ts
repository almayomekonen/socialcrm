import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { _resetAiEnvCacheForTests } from '../../lib/ai/env'
import { _resetProviderCacheForTests } from '../../lib/ai/providers'
import { generateQualifyTurn, handoffMessage } from '../../lib/inbox/autoresponse/qualify'
import { formatBusinessIdentityBlock } from '../../lib/inbox/autoresponse/businessIdentity'
import { formatProductKnowledgeBlock, retrieveProductKnowledge } from '../../lib/inbox/autoresponse/productRetrieve'
import {
  classifySalesTurnFromTranscript,
  detectHumanRequest,
  salesMoveUsesProductContract,
} from '../../lib/inbox/autoresponse/salesIntent'
import { questionPolicyForSalesMove, validateAutoResponse, classifyViolation } from '../../lib/inbox/autoresponse/validate'
import { hasCustomerFacingDash, finalizeCustomerFacingText } from '../../lib/inbox/autoresponse/customerFacingText'
import {
  decidePostGeneration,
  decidePreGeneration,
  isDiscoveryQuestionBudgetExhausted,
} from '../../lib/inbox/autoresponse/stateMachine'
import type { RegenerationReason } from '../../lib/inbox/autoresponse/qualifyPrompt'
import type { SalesStrategy } from '../../lib/inbox/autoresponse/qualification'

const IDENTITY = formatBusinessIdentityBlock({
  agencyId: 103,
  name: 'SocialCRM',
  guidance: 'מערכת לניהול לידים מרשתות חברתיות. מרכזת פניות, וואטסאפ וסטטוס במקום אחד.',
})

const CANNED = handoffMessage('human_request', 'he')
const HUMAN_REQUEST = 'סבבה, תעביר אותי לנציג אנושי'

const INBOUNDS = [
  'מה המערכת עושה?',
  'יש לכם וואטסאפ?',
  'גם פייסבוק נכנס לשם?',
  'איך מנהלים לידים במערכת?',
  'יש מעקב אחרי פניות?',
  'יש תזכורות לחזרה ללקוח?',
  'יש אוטומציה למענה?',
  'אפשר סטטוסים לכל ליד?',
  'איך השיחות נראות אצלכם?',
  'אפשר כמה אנשים בצוות להשתמש במערכת?',
  'איך נראה תהליך העבודה היומי?',
  'איך מתחילים?',
  'כמה זה עולה?',
  'המערכת יכולה לענות ללקוחות בוואטסאפ כשאני לא ליד המסך?',
  'אפשר לראות את כל הפניות במקום אחד?',
  'יש חיבור לאינסטגרם?',
  'מה קורה אם לקוח כותב בלילה?',
  'אפשר לסמן מי טיפל בפנייה?',
  'יש תזכורות מעקב אחרי לידים שקפאו?',
  'ימשיך שיחה עם הלקוח',
]

const ENV_KEYS = new Set([
  'OPENAI_API_KEY',
  'AI_ENABLED',
  'IRE_OPENAI_MODEL',
  'IRE_OPENAI_REASONING_EFFORT',
  'AI_AGENCY_ALLOWLIST',
  'IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS',
])

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
  for (const p of [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '../social-crm/.env.local'),
    '/Users/User/Documents/social-crm/.env.local',
  ]) {
    if (existsSync(p)) loadDotEnvFile(p)
  }
}

const basePre = {
  aiState: 'ai_qualifying' as const,
  masterEnabled: true,
  channelEnabled: true,
  humanTookOver: false,
  optOut: false,
  hasUnansweredInbound: true,
  withinQuietHours: false,
  withinWindow: true,
  sentTodayForAgency: 0,
  dailyCap: 200,
  maxTurns: 5,
}

type TurnRow = {
  n: number
  inbound: string
  salesMove: string
  salesStrategy: string
  preAction: string
  discoveryBudgetExhausted: boolean
  pkIds: string[]
  gptRan: boolean
  model?: string
  provider?: string
  postAction: string
  outbound: string | null
}

async function runTurn(args: {
  transcript: Array<{ direction: 'inbound' | 'outbound'; text: string }>
  inbound: string
  turnCount: number
  salesStrategy?: SalesStrategy
}): Promise<TurnRow> {
  const transcript = [...args.transcript, { direction: 'inbound' as const, text: args.inbound }]
  const classified = classifySalesTurnFromTranscript(transcript, { salesStrategy: args.salesStrategy })
  const salesMove = classified.salesMove
  const salesStrategy = classified.salesStrategy
  const discoveryBudgetExhausted = isDiscoveryQuestionBudgetExhausted({
    salesMove,
    turnCount: args.turnCount,
    maxTurns: 5,
  })
  const pre = decidePreGeneration({
    ...basePre,
    turnCount: args.turnCount,
    humanRequest: detectHumanRequest(args.inbound),
  })
  const pk = retrieveProductKnowledge({
    agencyId: 103,
    inboundText: args.inbound,
    salesMove,
    envRaw: process.env.IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS || '103',
  })
  const productKnowledgeBlock =
    salesMoveUsesProductContract(salesMove) || salesMove === 'OBJECTION' ? formatProductKnowledgeBlock(pk) : null
  const row: TurnRow = {
    n: args.turnCount + 1,
    inbound: args.inbound,
    salesMove,
    salesStrategy,
    preAction: pre.action + ('reason' in pre ? `:${pre.reason}` : ''),
    discoveryBudgetExhausted,
    pkIds: pk.capabilities.map((c) => c.id),
    gptRan: false,
    postAction: '',
    outbound: null,
  }
  if (pre.action !== 'proceed') {
    row.postAction = row.preAction
    return row
  }
  const genArgs = {
    agencyId: 103,
    transcript,
    qualification: { need: 'ניהול לידים מהרשתות', cognition: { salesStrategy } },
    collectFields: { required: ['name', 'need'] as string[], optional: [] as string[] },
    guidance: 'מערכת לניהול לידים מרשתות חברתיות',
    salesMove,
    salesStrategy,
    productKnowledgeBlock,
    businessIdentityBlock: IDENTITY,
    discoveryBudgetExhausted,
    bypassAllowlist: true,
  }
  const gen = await generateQualifyTurn(genArgs)
  if (gen.ok === false) {
    row.postAction = `gen_fail:${gen.skipReason}`
    return row
  }
  row.gptRan = true
  row.model = gen.model
  const policy = questionPolicyForSalesMove(salesMove, { discoveryBudgetExhausted })
  let generated = gen.reply
  let validation = validateAutoResponse(generated, { questionPolicy: policy })
  if (!validation.ok) {
    const originalViolation = 'violation' in validation ? validation.violation : 'invalid'
    const regenerationReason: RegenerationReason =
      classifyViolation(originalViolation) === 'safety' ? 'safety_validation' : 'shape_validation'
    const gen2 = await generateQualifyTurn({ ...genArgs, regenerationReason })
    const gen2Valid = gen2.ok === false ? null : validateAutoResponse(gen2.reply, { questionPolicy: policy })
    if (gen2.ok !== false && gen2Valid && gen2Valid.ok) {
      generated = gen2.reply
      validation = gen2Valid
      row.model = gen2.model
    }
  }
  const post = decidePostGeneration({
    hotSignal: gen.hotSignal,
    uncertain: gen.uncertain,
    requiredComplete: false,
    turnCount: args.turnCount,
    maxTurns: 5,
    salesMove,
  })
  row.postAction = post.action === 'escalate' ? `escalate:${post.reason}` : post.action
  row.outbound = post.action === 'send' ? finalizeCustomerFacingText(generated) : null
  return row
}

async function main() {
  loadLocalEnv()
  process.env.AI_ENABLED = process.env.AI_ENABLED || '1'
  process.env.IRE_OPENAI_MODEL = process.env.IRE_OPENAI_MODEL || 'gpt-5.6'
  process.env.IRE_OPENAI_REASONING_EFFORT = process.env.IRE_OPENAI_REASONING_EFFORT || 'high'
  _resetAiEnvCacheForTests()
  _resetProviderCacheForTests()
  if (!process.env.OPENAI_API_KEY) {
    console.error('NO OPENAI_API_KEY — cannot run live GPT-5.6 E2E')
    process.exit(2)
  }

  const errors: string[] = []
  const turns: TurnRow[] = []
  const transcript: Array<{ direction: 'inbound' | 'outbound'; text: string }> = []
  let salesStrategy: SalesStrategy | undefined

  for (let i = 0; i < INBOUNDS.length; i++) {
    const inbound = INBOUNDS[i]
    const row = await runTurn({ transcript, inbound, turnCount: i, salesStrategy })
    turns.push(row)
    console.log(
      `T${row.n} ${row.salesMove}/${row.salesStrategy} pre=${row.preAction} gpt=${row.gptRan} model=${row.model ?? '-'} pk=${row.pkIds.join(',') || '(none)'} post=${row.postAction}`,
    )
    console.log(`  IN  ${inbound}`)
    console.log(`  OUT ${row.outbound ?? '(none)'}`)
    if (row.preAction.includes('max_turns')) errors.push(`T${row.n} pre max_turns`)
    if (row.postAction.includes('max_turns')) errors.push(`T${row.n} post max_turns`)
    if (row.preAction !== 'proceed') errors.push(`T${row.n} pre ${row.preAction}`)
    if (!row.gptRan) errors.push(`T${row.n} GPT did not run`)
    if (row.model && !String(row.model).includes('gpt-5.6') && !String(row.model).includes('gpt-5')) {
      errors.push(`T${row.n} model ${row.model}`)
    }
    if (row.postAction !== 'send') errors.push(`T${row.n} post ${row.postAction}`)
    if (!row.outbound) errors.push(`T${row.n} silent/no outbound`)
    if (row.outbound === CANNED) errors.push(`T${row.n} canned handoff`)
    if (row.outbound && hasCustomerFacingDash(row.outbound)) errors.push(`T${row.n} dash in outbound`)
    if (row.outbound && /מישהו מהצוות ימשיך/.test(row.outbound)) errors.push(`T${row.n} canned team copy`)
    const expectPk = /וואטסאפ|פייסבוק|אינסטגרם|מענה אוטומטי|ימשיך שיחה|לא ליד המסך/
    if (expectPk.test(inbound) && row.pkIds.length === 0) {
      errors.push(`T${row.n} expected Product Knowledge for ${inbound}`)
    }
    if (row.outbound) {
      transcript.push({ direction: 'inbound', text: inbound })
      transcript.push({ direction: 'outbound', text: row.outbound })
    }
    salesStrategy = row.salesStrategy as SalesStrategy
  }

  const late = decidePreGeneration({
    ...basePre,
    turnCount: INBOUNDS.length,
    humanRequest: detectHumanRequest(HUMAN_REQUEST),
  })
  const lateMove = classifySalesTurnFromTranscript([...transcript, { direction: 'inbound', text: HUMAN_REQUEST }], {
    salesStrategy,
  })
  console.log('\n===== late-turn human request =====')
  console.log(`turnCount=${INBOUNDS.length} classifier=${lateMove.salesMove} pre=${JSON.stringify(late)}`)
  if (lateMove.salesMove !== 'HANDOFF_REQUEST') errors.push(`late classifier ${lateMove.salesMove}`)
  if (late.action !== 'handoff' || !('reason' in late) || late.reason !== 'human_request') {
    errors.push(`late pre ${JSON.stringify(late)}`)
  }
  if (late.action === 'skip' && 'reason' in late && late.reason === 'max_turns') {
    errors.push('late max_turns skip')
  }

  const payload = {
    turns,
    late: { turnCount: INBOUNDS.length, inbound: HUMAN_REQUEST, salesMove: lateMove.salesMove, pre: late },
    errors,
    model: process.env.IRE_OPENAI_MODEL,
    reasoning: process.env.IRE_OPENAI_REASONING_EFFORT,
  }
  const out = resolve(process.cwd(), 'docs/superpowers/ire-unlimited-conversation-e2e.json')
  try {
    writeFileSync(out, JSON.stringify(payload, null, 2))
  } catch {
    writeFileSync('/tmp/ire-unlimited-conversation-e2e.json', JSON.stringify(payload, null, 2))
  }
  if (errors.length) {
    console.error('\nE2E ASSERTIONS FAILED:\n' + errors.join('\n'))
    process.exit(1)
  }
  console.log('\nLIVE GPT-5.6 UNLIMITED CONVERSATION E2E PASSED')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
