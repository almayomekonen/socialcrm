/**
 * Local live GPT-5.6 E2E for P0 business identity.
 *
 *   npx tsx scripts/e2e/ire-business-identity.e2e.ts
 *
 * Uses OPENAI_API_KEY from .env.local. Does not write Production DB.
 * Does not send WhatsApp.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { _resetAiEnvCacheForTests } from '../../lib/ai/env'
import { _resetProviderCacheForTests } from '../../lib/ai/providers'
import { generateQualifyTurn, deterministicQualifyFallback } from '../../lib/inbox/autoresponse/qualify'
import { formatBusinessIdentityBlock } from '../../lib/inbox/autoresponse/businessIdentity'
import { formatProductKnowledgeBlock, retrieveProductKnowledge } from '../../lib/inbox/autoresponse/productRetrieve'
import { classifySalesTurnFromTranscript, salesMoveUsesProductContract } from '../../lib/inbox/autoresponse/salesIntent'
import {
  questionPolicyForSalesMove,
  validateAutoResponse,
  classifyViolation,
} from '../../lib/inbox/autoresponse/validate'
import { hasCustomerFacingDash, finalizeCustomerFacingText } from '../../lib/inbox/autoresponse/customerFacingText'
import { decidePostGeneration } from '../../lib/inbox/autoresponse/stateMachine'
import type { SalesStrategy } from '../../lib/inbox/autoresponse/qualification'
import type { RegenerationReason } from '../../lib/inbox/autoresponse/qualifyPrompt'

const IDENTITY = formatBusinessIdentityBlock({
  agencyId: 103,
  name: 'SocialCRM',
  guidance: 'מערכת לניהול לידים מרשתות חברתיות. מרכזת פניות, וואטסאפ וסטטוס במקום אחד.',
})

const ENV_KEYS = new Set([
  'OPENAI_API_KEY',
  'AI_ENABLED',
  'IRE_OPENAI_MODEL',
  'IRE_OPENAI_REASONING_EFFORT',
  'AI_AGENCY_ALLOWLIST',
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

type TurnRecord = {
  inbound: string
  classifier: string
  salesStrategy: string
  businessIdentity: 'present' | 'absent'
  productKnowledgeIds: string[]
  generated: string
  validation: { ok: boolean; violation: string | null; matchedForbidden: string | null }
  regeneration: 'none' | 'ok' | 'failed'
  fallback: boolean
  handoff: { action: string; reason?: string }
  finalSent: string | null
  model: string | undefined
  fail: string[]
}

async function runConversation(label: string, inbounds: string[]): Promise<TurnRecord[]> {
  const transcript: Array<{ direction: 'inbound' | 'outbound'; text: string }> = []
  const turns: TurnRecord[] = []
  let salesStrategy: SalesStrategy | undefined
  for (const inbound of inbounds) {
    transcript.push({ direction: 'inbound', text: inbound })
    const classified = classifySalesTurnFromTranscript(transcript, { salesStrategy })
    const salesMove = classified.salesMove
    salesStrategy = classified.salesStrategy
    const pk = retrieveProductKnowledge({
      agencyId: 103,
      inboundText: inbound,
      salesMove,
      envRaw: '103',
    })
    const productKnowledgeBlock =
      salesMoveUsesProductContract(salesMove) || salesMove === 'OBJECTION'
        ? formatProductKnowledgeBlock(pk)
        : null
    const genArgs = {
      agencyId: 103,
      transcript,
      qualification: {},
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
      turns.push({
        inbound,
        classifier: salesMove,
        salesStrategy,
        businessIdentity: IDENTITY ? 'present' : 'absent',
        productKnowledgeIds: pk.capabilities.map((c) => c.id),
        generated: '',
        validation: { ok: false, violation: gen.skipReason, matchedForbidden: null },
        regeneration: 'none',
        fallback: false,
        handoff: { action: 'skip', reason: gen.skipReason },
        finalSent: null,
        model: undefined,
        fail: [gen.skipReason],
      })
      continue
    }
    const policy = questionPolicyForSalesMove(salesMove)
    let validation = validateAutoResponse(gen.reply, { questionPolicy: policy })
    let generated = gen.reply
    let regeneration: TurnRecord['regeneration'] = 'none'
    let fallback = false
    let forcedGuardrail = false
    if (!validation.ok) {
      const originalViolation = 'violation' in validation ? validation.violation : 'invalid'
      const regenerationReason: RegenerationReason =
        classifyViolation(originalViolation) === 'safety' ? 'safety_validation' : 'shape_validation'
      const gen2 = await generateQualifyTurn({ ...genArgs, regenerationReason })
      const gen2Valid = gen2.ok === false ? null : validateAutoResponse(gen2.reply, { questionPolicy: policy })
      if (gen2.ok !== false && gen2Valid && gen2Valid.ok) {
        generated = gen2.reply
        validation = gen2Valid
        regeneration = 'ok'
      } else {
        regeneration = 'failed'
        const finalViolation = gen2Valid && 'violation' in gen2Valid ? gen2Valid.violation : originalViolation
        if (classifyViolation(finalViolation) === 'safety') {
          forcedGuardrail = true
        } else {
          generated = deterministicQualifyFallback({
            qualification: {},
            lastInboundText: inbound,
            transcript,
            salesMove,
            salesStrategy,
            lang: 'he',
          })
          validation = validateAutoResponse(generated, { questionPolicy: policy })
          fallback = true
        }
      }
    }
    let post = decidePostGeneration({
      hotSignal: gen.hotSignal,
      uncertain: gen.uncertain,
      requiredComplete: false,
      turnCount: turns.length,
      maxTurns: 5,
      salesMove,
    })
    if (forcedGuardrail) post = { action: 'escalate', reason: 'guardrail' }
    const sent = post.action === 'send' ? finalizeCustomerFacingText(generated) : null
    const fail: string[] = []
    if (post.action === 'send' && !validation.ok) fail.push(`validator:${'violation' in validation ? validation.violation : 'invalid'}`)
    if (sent && hasCustomerFacingDash(sent)) fail.push('dash')
    if (sent) transcript.push({ direction: 'outbound', text: sent })
    turns.push({
      inbound,
      classifier: salesMove,
      salesStrategy,
      businessIdentity: IDENTITY ? 'present' : 'absent',
      productKnowledgeIds: pk.capabilities.map((c) => c.id),
      generated,
      validation: {
        ok: validation.ok,
        violation: 'violation' in validation ? validation.violation : null,
        matchedForbidden: validation.details.matchedForbidden,
      },
      regeneration,
      fallback,
      handoff: post,
      finalSent: sent,
      model: gen.model,
      fail,
    })
  }
  console.log(`\n===== ${label} =====`)
  for (const t of turns) {
    console.log(`IN  [${t.classifier}/${t.salesStrategy}] ${t.inbound}`)
    console.log(`GEN [${t.model ?? 'n/a'}] ${t.generated}`)
    console.log(
      `VAL ok=${t.validation.ok} violation=${t.validation.violation ?? '-'} forbidden=${t.validation.matchedForbidden ?? '-'} regen=${t.regeneration} fallback=${t.fallback} handoff=${t.handoff.action}${t.handoff.reason ? ':' + t.handoff.reason : ''}`,
    )
    console.log(`PK  ${t.productKnowledgeIds.join(',') || '(none)'} identity=${t.businessIdentity}`)
    console.log(`OUT ${t.finalSent ?? '(not sent)'}`)
    if (t.fail.length) console.log(`FAIL ${t.fail.join(', ')}`)
  }
  return turns
}

function assertScenarioA(turns: TurnRecord[]) {
  const errors: string[] = []
  const askBiz = /מאיזה קישור|צילום מסך|על איזו מודעה|ספר.{0,12}על העסק|במה אתם עוסקים/i
  if (turns[0]?.classifier !== 'PRODUCT_QUESTION') errors.push('turn1 not PRODUCT_QUESTION')
  if (turns[1]?.classifier !== 'PRODUCT_QUESTION') errors.push('turn2 not PRODUCT_QUESTION')
  if (askBiz.test(turns[0]?.finalSent ?? '')) errors.push('turn1 interrogated the business')
  if (askBiz.test(turns[1]?.finalSent ?? '')) errors.push('turn2 interrogated the business')
  if (/₪|שקל|מחיר הוא|\d{2,}/.test(turns[2]?.finalSent ?? '')) errors.push('turn3 invented a price')
  if (turns[2]?.classifier !== 'BUYING_SIGNAL') errors.push('turn3 not BUYING_SIGNAL')
  if (turns[3]?.classifier !== 'BUYING_SIGNAL') errors.push('turn4 not BUYING_SIGNAL')
  if (/הדגמה|\bdemo\b/i.test(turns[3]?.finalSent ?? '')) errors.push('turn4 invented a demo')
  if (turns[4]?.classifier !== 'DISCOVERY' && turns[4]?.classifier !== 'DEEPEN' && turns[4]?.classifier !== 'PRODUCT_FIT') {
    errors.push(`turn5 unexpected move ${turns[4]?.classifier}`)
  }
  const volume = turns[4]?.inbound ?? ''
  if (!/100 לידים/.test(volume)) errors.push('turn5 inbound missing')
  return errors
}

function assertScenarioB(turns: TurnRecord[]) {
  const errors: string[] = []
  if (turns[0]?.classifier !== 'PRODUCT_QUESTION') errors.push('ad-origin not PRODUCT_QUESTION')
  if (/צילום מסך|קישור למודעה|מאיזה קישור|על איזו מודעה/.test(turns[0]?.finalSent ?? '')) {
    errors.push('asked for screenshot/ad link')
  }
  if (turns[2]?.classifier !== 'BUYING_SIGNAL') errors.push('start is not BUYING_SIGNAL')
  if (/הדגמה|\bdemo\b/i.test(turns[2]?.finalSent ?? '')) errors.push('start invented a demo')
  return errors
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
  const a = await runConversation('A identity + price + customer', [
    'שלום, במה אתם עוסקים?',
    'מה אתם מציעים?',
    'כמה זה עולה?',
    'איך מתחילים?',
    'אני מקבל בערך 100 לידים בחודש',
  ])
  const b = await runConversation('B ad origin', ['הגעתי מהמודעה שלכם', 'כן', 'אני רוצה להתחיל'])
  const errors = [...assertScenarioA(a).map((e) => `A: ${e}`), ...assertScenarioB(b).map((e) => `B: ${e}`)]
  const out = resolve(process.cwd(), 'docs/superpowers/ire-business-identity-e2e.json')
  const payload = { a, b, errors, model: process.env.IRE_OPENAI_MODEL }
  try {
    writeFileSync(out, JSON.stringify(payload, null, 2))
  } catch {
    writeFileSync('/tmp/ire-business-identity-e2e.json', JSON.stringify(payload, null, 2))
  }
  if (errors.length) {
    console.error('\nE2E ASSERTIONS FAILED:\n' + errors.join('\n'))
    process.exit(1)
  }
  console.log('\nLIVE GPT-5.6 E2E ASSERTIONS PASSED')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
