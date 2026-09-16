/**
 * THE RELEASE SMOKE SEQUENCE, run against the real model and a real database.
 *
 *   NODE_ENV=test npx tsx scripts/e2e/ire-smoke-sequence.e2e.ts
 *
 *   initial request → short answer → correction → human takeover →
 *   agent stays silent → explicit return to agent → agent answers again
 *
 * This is the post-deploy smoke test minus WhatsApp delivery: the generation is
 * a real model call, the ownership transitions are the real SQL writers against
 * a real Postgres, and the silence is decided by the real pre-generation gate
 * and the real send-authorization boundary. What it cannot cover is the Graph
 * call and the webhook round trip, which need a person with a phone.
 *
 * Run it BEFORE merging. A failure here is a failure that would otherwise be
 * found in production with a customer watching.
 */
import { db } from '@/config/db'
import { generateQualifyTurn } from '@/lib/inbox/autoresponse/qualify'
import { formatBusinessIdentityBlock, type BusinessIdentity } from '@/lib/inbox/autoresponse/businessIdentity'
import { classifySalesTurnFromTranscript } from '@/lib/inbox/autoresponse/salesIntent'
import { decideConversationControl } from '@/lib/inbox/autoresponse/conversationControl'
import { shouldInvokeSalesAi } from '@/lib/inbox/autoresponse/gptEligibility'
import { decidePreGeneration } from '@/lib/inbox/autoresponse/stateMachine'
import { authorizeAgentSend } from '@/lib/inbox/autoresponse/humanPresence'
import {
  markHumanActiveByConversation,
  readHumanPresence,
  returnConversationToAgent,
  takeOverConversationByRep,
} from '@/db/conversationHumanPresence'
import { getAiState } from '@/db/conversationAiState'
import { mergeQualification, type Qualification } from '@/lib/inbox/autoresponse/qualification'

const AGENCY_NAME = '__smoke_sequence__'
const PHONE_ID = '__smoke_pn'
const CUSTOMER = '972500000099'

const GARAGE: Omit<BusinessIdentity, 'agencyId'> = {
  name: 'מוסך אלון',
  guidance:
    'מוסך מורשה לרכבים פרטיים בחולון. פתוחים א׳–ה׳ 8:00–17:00. טיפולי שגרה, בלמים ובדיקה לפני טסט. ' +
    'עבודה בתיאום מראש. ברר איזה רכב, מה התקלה ומתי נוח, ואסוף פרטים כדי שנחזור ללקוח.',
  agentInstructions: null,
  isOwnProductBusiness: false,
  profile: null,
}

type Turn = { direction: 'inbound' | 'outbound'; text: string }

let failures = 0
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main() {
  // ── Seed ──────────────────────────────────────────────────────────────────
  const [a] = await db('agencies').insert({ name: AGENCY_NAME, autoResponseEnabled: true }).returning('id')
  const agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'F', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  const [c] = await db('clients')
    .insert({ firstName: 'לקוח', lastName: 'בדיקה', phone: CUSTOMER, agencyId, userId, createdById: userId, status: 'new' })
    .returning('id')
  const leadId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({
      agencyId,
      leadId,
      channel: 'whatsapp',
      businessPhoneNumberId: PHONE_ID,
      customerWaId: CUSTOMER,
      customerName: 'לקוח בדיקה',
    })
    .returning('id')
  const conversationId = Number(conv.id)
  await db('conversation_ai_state').insert({ conversationId, agencyId, aiState: 'new', aiTurnCount: 0 })

  const identity: BusinessIdentity = { ...GARAGE, agencyId }
  const transcript: Turn[] = []
  let qualification: Qualification = {}
  let aiTurnCount = 0
  let previousCustomerText: string | undefined

  /** One customer turn, all the way through to a generated reply (or silence). */
  async function customerSays(text: string): Promise<{ replied: boolean; reply?: string; reason: string }> {
    transcript.push({ direction: 'inbound', text })
    const state = await getAiState(conversationId)

    const pre = decidePreGeneration({
      aiState: state?.aiState ?? 'new',
      masterEnabled: true,
      channelEnabled: true,
      humanTookOver: false,
      humanTyping: false,
      optOut: false,
      hasUnansweredInbound: true,
      withinQuietHours: false,
      withinWindow: true,
      sentTodayForAgency: 0,
      dailyCap: 200,
      turnCount: aiTurnCount,
      maxTurns: 5,
    })
    if (pre.action !== 'proceed') {
      return { replied: false, reason: `pre_${'reason' in pre ? pre.reason : pre.action}` }
    }

    const { salesMove, salesStrategy } = classifySalesTurnFromTranscript(transcript)
    const previousOutbound = [...transcript].reverse().find((m) => m.direction === 'outbound')?.text
    const control = decideConversationControl({ salesMove, inboundText: text, previousOutbound })
    if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
      return { replied: false, reason: `control_${control.action}` }
    }
    const eligibility = shouldInvokeSalesAi({
      inboundText: text,
      previousOutbound,
      salesMove,
      controlAction: control.action,
      customerInboundCount: transcript.filter((m) => m.direction === 'inbound').length,
      previousCustomerText,
      agentHasSpoken: aiTurnCount > 0,
    })
    previousCustomerText = text
    if (eligibility.decision === 'WAIT') return { replied: false, reason: `gpt_wait_${eligibility.reason}` }

    const gen = await generateQualifyTurn({
      agencyId,
      transcript: transcript.map((m) => ({ direction: m.direction, text: m.text })),
      qualification,
      collectFields: { required: [], optional: [] },
      guidance: identity.guidance,
      businessIdentityBlock: formatBusinessIdentityBlock(identity),
      productKnowledgeBlock: null,
      salesMove,
      salesStrategy,
      summaryBlock: null,
      greetingLine: null,
      bypassAllowlist: true,
    })
    if (gen.ok === false) return { replied: false, reason: `generation_${gen.skipReason}` }

    // The final boundary, exactly as ireSend calls it.
    const presence = await readHumanPresence(conversationId)
    const authorized = authorizeAgentSend(presence, new Date().toISOString())
    if (authorized.authorized === false) {
      return { replied: false, reason: `send_blocked_${authorized.reason}` }
    }

    transcript.push({ direction: 'outbound', text: gen.reply })
    qualification = mergeQualification(qualification, gen.extracted, { corrected: gen.corrected })
    aiTurnCount++
    await db('conversation_ai_state')
      .where({ conversationId })
      .update({ aiState: 'ai_qualifying', aiTurnCount })
    return { replied: true, reply: gen.reply, reason: eligibility.reason }
  }

  try {
    console.log('═'.repeat(78))
    console.log('SMOKE SEQUENCE — real model, real database, real gates')
    console.log('═'.repeat(78))

    // 1. Initial request
    console.log('\n1. INITIAL REQUEST')
    const t1 = await customerSays('אני צריך תור')
    console.log(`  👤 אני צריך תור`)
    console.log(`  🤖 ${t1.reply ?? `(silent — ${t1.reason})`}`)
    check(t1.replied, 'a direct first message is answered', t1.reason)

    // 2. Short answer
    console.log('\n2. SHORT ANSWER')
    const t2 = await customerSays('טויוטה 2020')
    console.log(`  👤 טויוטה 2020`)
    console.log(`  🤖 ${t2.reply ?? `(silent — ${t2.reason})`}`)
    check(t2.replied, 'a two-word answer is answered', t2.reason)

    // 3. Correction
    console.log('\n3. CORRECTION')
    const t3 = await customerSays('סליחה, זה לא 2020 אלא 2021')
    console.log(`  👤 סליחה, זה לא 2020 אלא 2021`)
    console.log(`  🤖 ${t3.reply ?? `(silent — ${t3.reason})`}`)
    check(t3.replied, 'a correction is answered', t3.reason)
    check(/2021/.test(t3.reply ?? ''), 'the corrected value is acknowledged')
    check(!/\b2020\b/.test(t3.reply ?? ''), 'the stale value is not repeated back')

    // 4. Human takeover
    console.log('\n4. HUMAN TAKEOVER')
    const took = await takeOverConversationByRep({ conversationId, agencyId })
    const afterTakeover = await getAiState(conversationId)
    check(took, 'the rep takes the conversation over')
    check(afterTakeover?.aiState === 'human_active', 'state is human_active', String(afterTakeover?.aiState))

    // 5. The agent stays silent
    console.log('\n5. AGENT STAYS SILENT')
    const t5 = await customerSays('אפשר גם לבדוק את המזגן?')
    console.log(`  👤 אפשר גם לבדוק את המזגן?   (a real question — the strongest input)`)
    console.log(`  🤖 ${t5.reply ?? `(silent — ${t5.reason})`}`)
    check(!t5.replied, 'the agent does NOT reply over the human', t5.reason)
    check(t5.reason === 'pre_human_active', 'and it stops at the lifecycle gate, before any model call', t5.reason)

    // 5b. Belt and braces: the send boundary refuses too.
    const blocked = authorizeAgentSend(await readHumanPresence(conversationId), new Date().toISOString())
    check(blocked.authorized === false, 'the send boundary independently refuses', 'reason' in blocked ? blocked.reason : '')

    // 6. Explicit return to agent
    console.log('\n6. EXPLICIT RETURN TO AGENT')
    const returned = await returnConversationToAgent({ conversationId, agencyId })
    const afterReturn = await getAiState(conversationId)
    check(returned, 'the rep hands it back')
    check(afterReturn?.aiState === 'ai_qualifying', 'state is ai_qualifying', String(afterReturn?.aiState))
    check(Number(afterReturn?.aiTurnCount) === aiTurnCount, 'the turn count survives, so no second greeting')

    // 7. The agent answers again
    console.log('\n7. AGENT ANSWERS AGAIN')
    const t7 = await customerSays('אז מה השלב הבא?')
    console.log(`  👤 אז מה השלב הבא?`)
    console.log(`  🤖 ${t7.reply ?? `(silent — ${t7.reason})`}`)
    check(t7.replied, 'the agent resumes after an explicit return', t7.reason)
    check(!/ברוך הבא/.test(t7.reply ?? ''), 'and does not greet the customer a second time')

    // 8. The stop that must NOT be liftable
    console.log('\n8. THE STOP A REP CANNOT LIFT')
    await db('conversation_ai_state').where({ conversationId }).update({ aiState: 'opted_out', stoppedReason: 'opt_out' })
    const lifted = await returnConversationToAgent({ conversationId, agencyId })
    const afterOptOut = await getAiState(conversationId)
    check(!lifted, 'return-to-agent refuses an opted-out conversation')
    check(afterOptOut?.aiState === 'opted_out', 'and the opt-out stands', String(afterOptOut?.aiState))
    const takeoverOnOptOut = await markHumanActiveByConversation(conversationId, agencyId)
    void takeoverOnOptOut

    console.log('\n' + '═'.repeat(78))
    console.log(failures === 0 ? 'SMOKE SEQUENCE PASSED' : `SMOKE SEQUENCE FAILED — ${failures} check(s)`)
    console.log('═'.repeat(78))
  } finally {
    await db('conversation_ai_state').where({ conversationId }).del()
    await db('inbox_messages').where({ conversationId }).del()
    await db('inbox_conversations').where({ id: conversationId }).del()
    await db('clients').where({ id: leadId }).del()
    await db('users').where({ id: userId }).del()
    await db('agencies').where({ id: agencyId }).del()
    await db.destroy()
  }
  process.exit(failures === 0 ? 0 : 1)
}

void main()
