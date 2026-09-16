/**
 * MODEL-RESPONSE EVALUATION — multi-turn conversations, real model.
 *
 *   npx tsx scripts/e2e/ire-multi-turn.e2e.ts
 *
 * The unit tests prove the GATE lets a short answer through. They cannot prove
 * the model then USES it — that it hears "מחר" as the answer to the question it
 * just asked, carries "טויוטה 2020" forward, accepts a correction, and does not
 * ask again for something already supplied. That is a model-behaviour question
 * and this is the only thing in the repository that answers it.
 *
 * Deterministic parts (which turn is answered, what the validator rejects) are
 * reported too, but they are ALSO covered by the test suite. What is unique here
 * is everything under "the model's own conduct".
 *
 * Requires provider credentials and AI_ENABLED=true. Non-deterministic by
 * nature: one run is a sample, not a proof.
 */
import { generateQualifyTurn, detectLang } from '@/lib/inbox/autoresponse/qualify'
import {
  formatBusinessIdentityBlock,
  groundedFactsFor,
  type BusinessIdentity,
} from '@/lib/inbox/autoresponse/businessIdentity'
import { classifySalesTurnFromTranscript } from '@/lib/inbox/autoresponse/salesIntent'
import { decideConversationControl } from '@/lib/inbox/autoresponse/conversationControl'
import { shouldInvokeSalesAi } from '@/lib/inbox/autoresponse/gptEligibility'
import { questionPolicyForSalesMove, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { mergeQualification, type Qualification } from '@/lib/inbox/autoresponse/qualification'

const AGENCY_ID = Number(process.env.E2E_AGENCY_ID ?? 103)

/**
 * Silences the design intends. A turn skipped for one of these is CORRECT
 * behaviour, not a dropped answer — "כן" after a statement has nothing to say
 * yes to. Anything else, NO_MEANINGFUL_INTENT above all, is a failure.
 */
const DELIBERATE_SILENCE = new Set([
  'SHORT_AFFIRMATIVE',
  'CLOSING_ACKNOWLEDGEMENT',
  'LOW_INFORMATION',
  'HOLD_ON',
  'NO_NEW_CONTENT',
  'GREETING_REPEAT',
  'DEFERRAL',
])

/**
 * `knownAfterTurn` is the index of the customer turn that supplies the fact.
 * Only replies produced AFTER it are scanned — otherwise the probe catches the
 * agent legitimately asking the question the first time, and reports perfect
 * memory as a failure. An earlier version did exactly that.
 */
type Probe = { label: string; re: RegExp; knownAfterTurn: number }

type Scenario = {
  name: string
  identity: BusinessIdentity
  /** The customer's side, fixed so runs are comparable. */
  customerTurns: string[]
  /**
   * Things the customer HAS ALREADY SAID by the end. If the agent asks for any
   * of them again, it failed the memory requirement.
   */
  reAskProbes: Probe[]
  /** A correction the customer made; the stale value must not survive. */
  correction?: { stale: RegExp; corrected: RegExp; label: string }
}

const GARAGE: Scenario = {
  name: 'garage',
  identity: {
    agencyId: AGENCY_ID,
    name: 'מוסך אלון',
    guidance:
      'מוסך מורשה לרכבים פרטיים בחולון. פתוחים א׳–ה׳ 8:00–17:00. טיפולי שגרה, בלמים, מזגן ובדיקה לפני טסט. ' +
      'עבודה בתיאום מראש. ברר איזה רכב, מה התקלה ומתי נוח ללקוח, ואסוף פרטים כדי שנחזור אליו לתיאום.',
    agentInstructions: null,
    isOwnProductBusiness: false,
    profile: null,
  },
  customerTurns: [
    'היי, יש לי בעיה ברכב',
    'טויוטה 2020',
    'רעש בבלמים כשאני עוצר',
    'רק טיפול',
    'מחר',
    'סליחה, זה לא 2020 אלא 2021',
    'כן',
  ],
  /**
   * FACTS ONLY. Scheduling is deliberately not probed: asking "מתי נוח לך?" and
   * then, after "מחר", asking "באיזו שעה נוח לך מחר?" is narrowing from day to
   * hour while carrying the answer forward — correct conversational behaviour
   * that an earlier version of this probe scored as a re-ask. A probe that
   * punishes the right behaviour measures nothing.
   */
  // customerTurns: 0 'בעיה ברכב' · 1 'טויוטה 2020' · 2 'רעש בבלמים' · 3 'רק טיפול'
  reAskProbes: [
    { label: 'the car make', re: /איזה רכב|סוג הרכב/, knownAfterTurn: 1 },
    { label: 'the year', re: /איזו שנה|שנתון|מאיזו שנה/, knownAfterTurn: 1 },
    { label: 'the fault', re: /מה התקלה|איזו תקלה|מה הבעיה ברכב/, knownAfterTurn: 2 },
  ],
  correction: { stale: /2020/, corrected: /2021/, label: 'the year 2020 → 2021' },
}

const CLINIC: Scenario = {
  name: 'clinic',
  identity: {
    agencyId: AGENCY_ID,
    name: 'מרפאת שיניים חיוך',
    guidance:
      'מרפאת שיניים ברמת גן. פתוחים א׳–ה׳ 9:00–19:00. סתימות, כתרים, ניקוי אבנית והלבנות. ' +
      'עובדים עם מכבי ומאוחדת. ברר מה הפנייה, אם יש ביטוח ומתי נוח, ואסוף פרטים לחזרה מהמרפאה.',
    agentInstructions: null,
    isOwnProductBusiness: false,
    profile: null,
  },
  customerTurns: ['שלום, רציתי לקבוע', 'כאב בשן', 'מכבי', 'בבוקר', 'דנה לוי', 'כן'],
  // Facts only, for the same reason as the garage above.
  // customerTurns: 0 'רציתי לקבוע' · 1 'כאב בשן' · 2 'מכבי' · 3 'בבוקר' · 4 'דנה לוי'
  reAskProbes: [
    { label: 'the reason for contact', re: /מה הפנייה|במה נוכל לעזור|לאיזה טיפול/, knownAfterTurn: 1 },
    { label: 'the insurer', re: /איזה ביטוח|איזו קופה|ביטוח פרטי או/, knownAfterTurn: 2 },
    { label: 'the name', re: /מה השם|השם המלא|איך קוראים/, knownAfterTurn: 4 },
  ],
}

const SOCIALCRM: Scenario = {
  name: 'socialcrm',
  identity: {
    agencyId: AGENCY_ID,
    name: 'SocialCRM',
    guidance:
      'SocialCRM מרכזת לידים מוואטסאפ, פייסבוק ואינסטגרם במקום אחד, עם סטטוס ומעקב לכל ליד. ' +
      'ברר מאיפה מגיעים הלידים, כמה יש בחודש ואיך עוקבים היום, ואסוף פרטים כדי שנחזור ללקוח.',
    agentInstructions: null,
    isOwnProductBusiness: true,
    profile: null,
  },
  customerTurns: [
    'היי אשמח לקבל פרטים על המערכת שלכם',
    'פייסבוק ואינסטגרם',
    'בערך 200',
    'לבד',
    'באקסל',
    'כן',
  ],
  // customerTurns: 0 'פרטים' · 1 'פייסבוק ואינסטגרם' · 2 'בערך 200' · 3 'לבד' · 4 'באקסל'
  reAskProbes: [
    { label: 'the lead sources', re: /מאיפה מגיעים|מאיפה הלידים|מאילו ערוצים/, knownAfterTurn: 1 },
    { label: 'the volume', re: /כמה לידים|כמה בחודש|כמה בערך/, knownAfterTurn: 2 },
    { label: 'how they track today', re: /איך אתה עוקב|איך אתם עוקבים|במה אתה משתמש/, knownAfterTurn: 4 },
  ],
}

type Turn = { direction: 'inbound' | 'outbound'; text: string }

async function runScenario(s: Scenario) {
  console.log('\n' + '═'.repeat(78))
  console.log(`${s.name.toUpperCase()} — ${s.identity.name}`)
  console.log('═'.repeat(78))

  const transcript: Turn[] = []
  let qualification: Qualification = {}
  let agentHasSpoken = false
  let previousCustomerText: string | undefined

  const dropped: string[] = []
  const rejected: string[] = []
  const replies: Array<{ afterTurn: number; text: string }> = []

  for (const [turnIndex, customerText] of s.customerTurns.entries()) {
    transcript.push({ direction: 'inbound', text: customerText })
    const { salesMove, salesStrategy } = classifySalesTurnFromTranscript(transcript)
    const previousOutbound = [...transcript].reverse().find((m) => m.direction === 'outbound')?.text

    const control = decideConversationControl({ salesMove, inboundText: customerText, previousOutbound })
    if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
      console.log(`  👤 ${customerText}`)
      console.log(`  ⛔ control ${control.action} — no reply`)
      dropped.push(`${customerText} (control ${control.action})`)
      previousCustomerText = customerText
      continue
    }

    const eligibility = shouldInvokeSalesAi({
      inboundText: customerText,
      previousOutbound,
      salesMove,
      controlAction: control.action,
      customerInboundCount: transcript.filter((m) => m.direction === 'inbound').length,
      previousCustomerText,
      agentHasSpoken,
    })
    console.log(`  👤 ${customerText}`)
    if (eligibility.decision === 'WAIT') {
      console.log(`  ⛔ gate WAIT — ${eligibility.reason}`)
      dropped.push(
        `${customerText} (${eligibility.reason}${DELIBERATE_SILENCE.has(eligibility.reason) ? ' — by design' : ' ✗ UNINTENDED'})`,
      )
      previousCustomerText = customerText
      continue
    }

    const gen = await generateQualifyTurn({
      agencyId: AGENCY_ID,
      transcript: transcript.map((m) => ({ direction: m.direction, text: m.text })),
      qualification,
      collectFields: { required: [], optional: [] },
      guidance: s.identity.guidance,
      businessIdentityBlock: formatBusinessIdentityBlock(s.identity),
      productKnowledgeBlock: null,
      salesMove,
      salesStrategy,
      summaryBlock: null,
      greetingLine: null,
      bypassAllowlist: true,
    })

    if (gen.ok === false) {
      console.log(`  ✗ generation unavailable: ${gen.skipReason}`)
      return null
    }

    const validation = validateAutoResponse(gen.reply, {
      questionPolicy: questionPolicyForSalesMove(salesMove),
      groundedFacts: groundedFactsFor(s.identity),
      greetingTurn: !agentHasSpoken,
    })
    const verdict = validation.ok ? 'ok' : `REJECTED (${'violation' in validation ? validation.violation : ''})`
    if (!validation.ok) rejected.push(`"${gen.reply}" → ${verdict}`)

    console.log(`  🤖 ${gen.reply}`)
    console.log(`     [${eligibility.reason} · ${salesMove} · validator ${verdict}]`)

    transcript.push({ direction: 'outbound', text: gen.reply })
    replies.push({ afterTurn: turnIndex, text: gen.reply })
    qualification = mergeQualification(qualification, gen.extracted, { corrected: gen.corrected })
    agentHasSpoken = true
    previousCustomerText = customerText
  }

  // ── The model's own conduct — the part no unit test can assert ─────────────
  const lastReply = replies[replies.length - 1]?.text ?? ''

  // Only replies produced after the fact was supplied can be a re-ask.
  const reAsked = s.reAskProbes.filter((probe) =>
    replies.some((r) => r.afterTurn > probe.knownAfterTurn && probe.re.test(r.text)),
  )
  const greetedTwice = replies.slice(1).filter((r) => /ברוך הבא|ברוכה הבאה/.test(r.text))

  console.log('\n  ' + '─'.repeat(74))
  const unintended = dropped.filter((d) => d.includes('UNINTENDED'))
  console.log(
    `  customer turns answered : ${replies.length}/${s.customerTurns.length}` +
      `${dropped.length ? ` (${dropped.length} silent, ${unintended.length} unintended)` : ''}`,
  )
  if (dropped.length) for (const d of dropped) console.log(`    dropped: ${d}`)
  // A rejection here is the FIRST draft being refused. In production the worker
  // regenerates and only falls back to a safe holding reply if the second draft
  // fails too, so this counts guardrail activity, not messages sent.
  console.log(`  first drafts rejected   : ${rejected.length}`)
  for (const r of rejected) console.log(`    ${r}`)
  console.log(`  re-asked something already answered : ${reAsked.length ? reAsked.map((p) => p.label).join('; ') : 'none ✓'}`)
  console.log(`  greeted more than once  : ${greetedTwice.length ? `✗ ${greetedTwice.length}` : 'none ✓'}`)

  if (s.correction) {
    const staleSurvives = s.correction.stale.test(lastReply)
    const correctedSeen = s.correction.corrected.test(replies.map((r) => r.text).join('\n'))
    console.log(
      `  correction (${s.correction.label}) : ${correctedSeen && !staleSurvives ? 'applied ✓' : staleSurvives ? '✗ STALE VALUE SURVIVES' : '— not restated'}`,
    )
  }
  console.log(`  structured memory       : ${JSON.stringify(qualification)}`)

  return {
    name: s.name,
    answered: replies.length,
    expected: s.customerTurns.length,
    dropped,
    unintended: unintended.length,
    rejected: rejected.length,
    reAsked: reAsked.map((p) => p.label),
    greetedTwice: greetedTwice.length,
  }
}

async function main() {
  console.log('MULTI-TURN CONVERSATION EVALUATION — real model, real prompts')
  console.log(`agency ${AGENCY_ID}`)

  const results = []
  for (const s of [GARAGE, CLINIC, SOCIALCRM]) {
    const r = await runScenario(s)
    if (!r) {
      console.log('\nABORTED — the model was unavailable. Nothing below was measured.')
      return
    }
    results.push(r)
  }

  console.log('\n' + '═'.repeat(78))
  console.log('VERDICT')
  console.log('═'.repeat(78))
  for (const r of results) {
    const ok = r.unintended === 0 && r.reAsked.length === 0 && r.greetedTwice === 0
    console.log(
      `  ${ok ? '✓' : '✗'} ${r.name.padEnd(10)} answered ${r.answered}/${r.expected}` +
        `  unintended drops ${r.unintended}  re-asks ${r.reAsked.length}` +
        `  double-greetings ${r.greetedTwice}  first drafts rejected ${r.rejected}`,
    )
  }
  console.log('\nOne run of a non-deterministic system. Re-run before widening a pilot')
  console.log('and after any prompt change.')
}

void main()
