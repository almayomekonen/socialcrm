/**
 * Local live GPT-5.6 E2E for P0 human-request precision.
 *
 *   npx tsx scripts/e2e/ire-human-request-precision.e2e.ts
 *
 * Reproduces Production conv 723 turn 5. Does not write Production DB.
 * Does not send WhatsApp.
 */
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
  isProductStrategy,
  salesMoveUsesProductContract,
} from '../../lib/inbox/autoresponse/salesIntent'
import { questionPolicyForSalesMove, validateAutoResponse, classifyViolation } from '../../lib/inbox/autoresponse/validate'
import { hasCustomerFacingDash, finalizeCustomerFacingText } from '../../lib/inbox/autoresponse/customerFacingText'
import { decidePostGeneration, decidePreGeneration } from '../../lib/inbox/autoresponse/stateMachine'
import type { RegenerationReason } from '../../lib/inbox/autoresponse/qualifyPrompt'

const IDENTITY = formatBusinessIdentityBlock({
  agencyId: 103,
  name: 'SocialCRM',
  guidance: 'מערכת לניהול לידים מרשתות חברתיות. מרכזת פניות, וואטסאפ וסטטוס במקום אחד.',
})

const PREV_OUTBOUND =
  'הבנתי, מענה אוטומטי לפניות חדשות בוואטסאפ כדי שלא יישארו בלי תגובה. היית רוצה שהוא רק ישיב מיד, או גם ימשיך את השיחה עם הלקוח?'
const PROD_INBOUND = 'ימשיך שיחה  עם הלקוח'
const CANNED = handoffMessage('human_request', 'he')

const TRANSCRIPT: Array<{ direction: 'inbound' | 'outbound'; text: string }> = [
  { direction: 'inbound', text: 'היי שלום אשמח לקבל פרטים על השירותים שלכם' },
  { direction: 'outbound', text: 'היי, בשמחה. כדי לתת לך פרטים מדויקים ורלוונטיים, מה היית רוצה להשיג כרגע בעסק?' },
  { direction: 'inbound', text: 'אני רוצה להשיג שקט וניהול נכון' },
  { direction: 'outbound', text: 'כדי להבין איפה הכי נכון לעשות סדר, מה היום גוזל ממך הכי הרבה שקט בניהול העסק?' },
  { direction: 'inbound', text: 'מערכת שתעזור לי לשלוח הודעות חימום ללקוחות חדשים ולא לאבד אותם' },
  { direction: 'outbound', text: 'הכוונה להודעות יזומות אחרי שלקוח חדש משאיר פרטים, או למענה אוטומטי כשהוא פונה בוואטסאפ?' },
  { direction: 'inbound', text: 'מענה אוטומטי' },
  { direction: 'outbound', text: PREV_OUTBOUND },
  { direction: 'inbound', text: PROD_INBOUND },
]

const EXPLICIT = [
  'תעביר אותי לנציג',
  'אני רוצה לדבר עם נציג',
  'אני רוצה לדבר עם בן אדם',
  'אפשר לדבר עם מישהו?',
  'תחבר אותי לנציג',
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

const preFacts = {
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
  turnCount: 4,
  maxTurns: 5,
}

async function generateFailingTurn() {
  const classified = classifySalesTurnFromTranscript(TRANSCRIPT, { salesStrategy: 'discover' })
  const salesMove = classified.salesMove
  const salesStrategy = classified.salesStrategy
  const pk = retrieveProductKnowledge({
    agencyId: 103,
    inboundText: PROD_INBOUND,
    salesMove,
    envRaw: process.env.IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS || '103',
  })
  const productKnowledgeBlock =
    salesMoveUsesProductContract(salesMove) || salesMove === 'OBJECTION' ? formatProductKnowledgeBlock(pk) : null
  const genArgs = {
    agencyId: 103,
    transcript: TRANSCRIPT,
    qualification: {
      need: 'להשיג שקט וניהול נכון בעסק',
      cognition: { lastObjective: 'understand_outcome' as const, salesStrategy: 'discover' as const },
    },
    collectFields: { required: ['name', 'need'] as string[], optional: [] as string[] },
    guidance: 'מערכת לניהול לידים מרשתות חברתיות',
    salesMove,
    salesStrategy,
    productKnowledgeBlock,
    businessIdentityBlock: IDENTITY,
    bypassAllowlist: true,
  }
  const gen = await generateQualifyTurn(genArgs)
  if (gen.ok === false) {
    return {
      classified,
      pre: decidePreGeneration({
        ...preFacts,
        humanRequest: detectHumanRequest(PROD_INBOUND, { previousOutbound: PREV_OUTBOUND }),
      }),
      genOk: false as const,
      skipReason: gen.skipReason,
      generated: '',
      finalSent: null as string | null,
      post: { action: 'skip', reason: gen.skipReason },
      pkIds: pk.capabilities.map((c) => c.id),
      model: undefined as string | undefined,
    }
  }
  const policy = questionPolicyForSalesMove(salesMove)
  let validation = validateAutoResponse(gen.reply, { questionPolicy: policy })
  let generated = gen.reply
  if (!validation.ok) {
    const originalViolation = 'violation' in validation ? validation.violation : 'invalid'
    const regenerationReason: RegenerationReason =
      classifyViolation(originalViolation) === 'safety' ? 'safety_validation' : 'shape_validation'
    const gen2 = await generateQualifyTurn({ ...genArgs, regenerationReason })
    const gen2Valid = gen2.ok === false ? null : validateAutoResponse(gen2.reply, { questionPolicy: policy })
    if (gen2.ok !== false && gen2Valid && gen2Valid.ok) {
      generated = gen2.reply
      validation = gen2Valid
    }
  }
  const post = decidePostGeneration({
    hotSignal: gen.hotSignal,
    uncertain: gen.uncertain,
    requiredComplete: false,
    turnCount: 4,
    maxTurns: 5,
    salesMove,
  })
  const sent = post.action === 'send' ? finalizeCustomerFacingText(generated) : null
  return {
    classified,
    pre: decidePreGeneration({
      ...preFacts,
      humanRequest: detectHumanRequest(PROD_INBOUND, { previousOutbound: PREV_OUTBOUND }),
    }),
    genOk: true as const,
    generated,
    validation,
    post,
    finalSent: sent,
    pkIds: pk.capabilities.map((c) => c.id),
    model: gen.model,
  }
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
  for (const text of EXPLICIT) {
    if (!detectHumanRequest(text)) errors.push(`explicit missed: ${text}`)
    const pre = decidePreGeneration({ ...preFacts, humanRequest: detectHumanRequest(text) })
    if (pre.action !== 'handoff' || !('reason' in pre) || pre.reason !== 'human_request') {
      errors.push(`explicit pre not handoff: ${text} → ${JSON.stringify(pre)}`)
    }
  }

  const result = await generateFailingTurn()
  console.log('\n===== conv723 turn5 product continue-conversation =====')
  console.log(`classifier ${result.classified.salesMove} / ${result.classified.salesStrategy}`)
  console.log(`pre ${JSON.stringify(result.pre)}`)
  console.log(`pk ${result.pkIds.join(',') || '(none)'}`)
  if (result.genOk === false) {
    console.log(`GEN FAIL ${result.skipReason}`)
    errors.push(`gpt unavailable: ${result.skipReason}`)
  } else {
    console.log(`GEN [${result.model ?? 'n/a'}] ${result.generated}`)
    console.log(`post ${result.post.action}${result.post.action === 'escalate' && 'reason' in result.post ? ':' + result.post.reason : ''}`)
    console.log(`OUT ${result.finalSent ?? '(not sent)'}`)
    if (result.classified.salesMove === 'HANDOFF_REQUEST') errors.push('classifier HANDOFF_REQUEST')
    if (result.classified.salesMove === 'DISCOVERY') errors.push('classifier DISCOVERY')
    if (result.classified.salesMove !== 'PRODUCT_QUESTION' && result.classified.salesMove !== 'PRODUCT_FIT') {
      errors.push(`classifier ${result.classified.salesMove}, expected PRODUCT_QUESTION or PRODUCT_FIT`)
    }
    if (!isProductStrategy(result.classified.salesStrategy)) {
      errors.push(`salesStrategy ${result.classified.salesStrategy} is not a product strategy`)
    }
    if (result.pre.action === 'handoff') errors.push('pre-generation immediate handoff')
    if (result.post.action !== 'send') errors.push(`post-generation ${result.post.action}`)
    if (!result.pkIds.includes('whatsapp_inbound_auto_response')) {
      errors.push(`pk missing inbound auto-response: ${result.pkIds.join(',') || '(none)'}`)
    }
    if (!result.finalSent) errors.push('no GPT outbound')
    if (result.finalSent === CANNED) errors.push('sent canned human_request copy')
    if (result.finalSent && hasCustomerFacingDash(result.finalSent)) errors.push('dash in outbound')
    const sent = result.finalSent ?? ''
    if (/אין לי מידע מאומת/.test(sent)) errors.push('hedged: lacks verified information')
    if (/תרצה לדבר עם נציג|תעביר אותך לנציג|מישהו מהצוות ימשיך/.test(sent)) {
      errors.push('unnecessary human handoff in GPT copy')
    }
    if (/צילום מסך|קישור למודעה|מאיזה קישור/.test(sent)) errors.push('asked for screenshot/link')
    if (/מה היית רוצה להשיג|מאיפה (?:רוב )?הלידים/.test(sent)) errors.push('unnecessary discovery question')
    if (!/מענה אוטומטי|לא ליד המסך|הודעה קבועה|מענה חכם/.test(sent)) {
      errors.push('reply does not use verified inbound auto-response Product Knowledge')
    }
  }

  const out = resolve(process.cwd(), 'docs/superpowers/ire-human-request-precision-e2e.json')
  const payload = { result, errors, canned: CANNED, model: process.env.IRE_OPENAI_MODEL }
  try {
    writeFileSync(out, JSON.stringify(payload, null, 2))
  } catch {
    writeFileSync('/tmp/ire-human-request-precision-e2e.json', JSON.stringify(payload, null, 2))
  }
  if (errors.length) {
    console.error('\nE2E ASSERTIONS FAILED:\n' + errors.join('\n'))
    process.exit(1)
  }
  console.log('\nLIVE GPT-5.6 HUMAN-REQUEST PRECISION E2E PASSED')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
