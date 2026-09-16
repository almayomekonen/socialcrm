/**
 * MODEL-RESPONSE EVALUATION — long-context recall, corrections and memory.
 *
 *   npx tsx scripts/e2e/ire-long-context.e2e.ts
 *
 * The unit tests prove a detail FALLS OUT of the verbatim window and lands in
 * the summariser's batch. They cannot prove the model then uses it. This runs
 * the real thing: a long conversation, a real summarisation call, then a real
 * generation with only the summary plus the recent window — and checks whether
 * the agent still knows what the customer said forty messages ago.
 *
 * Requires provider credentials and AI_ENABLED=true.
 */
import { generateQualifyTurn, detectLang } from '@/lib/inbox/autoresponse/qualify'
import {
  formatBusinessIdentityBlock,
  groundedFactsFor,
  type BusinessIdentity,
} from '@/lib/inbox/autoresponse/businessIdentity'
import { classifySalesTurnFromTranscript } from '@/lib/inbox/autoresponse/salesIntent'
import { questionPolicyForSalesMove, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { mergeQualification, type Qualification } from '@/lib/inbox/autoresponse/qualification'
import {
  formatSummaryBlock,
  planSummary,
  recentWindow,
  summariseConversation,
  RECENT_WINDOW,
  type Turn,
} from '@/lib/inbox/autoresponse/conversationSummary'

const AGENCY_ID = Number(process.env.E2E_AGENCY_ID ?? 103)

const GARAGE: BusinessIdentity = {
  agencyId: AGENCY_ID,
  name: 'מוסך אלון',
  guidance:
    'מוסך מורשה לרכבים פרטיים בחולון. פתוחים א׳–ה׳ 8:00–17:00. טיפולי שגרה, בלמים, מזגן ובדיקה לפני טסט. ' +
    'עבודה בתיאום מראש. אפשר להשאיר רכב בבוקר ולאסוף בסוף היום.',
  agentInstructions: 'לברר איזה רכב ומה התקלה. הצעות מחיר נותנים רק במוסך.',
  isOwnProductBusiness: false,
  profile: null,
}

/**
 * Facts planted EARLY, then buried under filler so they fall outside the
 * verbatim window. Each is something the agent must not ask about again.
 */
const PLANTED: Array<{ at: number; text: string; label: string; recallProbe: RegExp }> = [
  { at: 1, text: 'הרכב שלי מאזדה 3 משנת 2018', label: 'car model + year', recallProbe: /מאזדה|2018/ },
  { at: 3, text: 'הבעיה היא רעש בבלמים כשאני עוצר', label: 'the fault', recallProbe: /בלמ|רעש/ },
  { at: 5, text: 'אני לא יכול בימי שלישי, אני עובד', label: 'a constraint', recallProbe: /שליש/ },
  { at: 7, text: 'סליחה, זה לא 2018 אלא 2019', label: 'a CORRECTION to the year', recallProbe: /2019/ },
]

function buildConversation(): Turn[] {
  const turns: Turn[] = []
  let seq = 0
  const push = (direction: 'inbound' | 'outbound', text: string) => {
    seq += 1
    turns.push({ sequence: seq, direction, text })
  }

  push('inbound', 'שלום, יש לי בעיה ברכב')
  push('outbound', 'היי, ברוך הבא למוסך אלון 👋 איזה רכב ומה התקלה?')

  for (const p of PLANTED) {
    push('inbound', p.text)
    push('outbound', 'קיבלתי, תודה.')
  }

  // Filler long enough to push everything above out of the verbatim window.
  for (let i = 0; i < RECENT_WINDOW + 6; i++) {
    push(i % 2 === 0 ? 'inbound' : 'outbound', `הודעה נוספת מספר ${i + 1}`)
  }

  // The probe: a question the agent can only answer from memory.
  push('inbound', 'אז מה אתם צריכים ממני כדי להתקדם?')
  return turns
}

async function main() {
  const all = buildConversation()
  const window = recentWindow(all)

  console.log('═'.repeat(78))
  console.log('LONG-CONTEXT RECALL — real model')
  console.log('═'.repeat(78))
  console.log(`  conversation length : ${all.length} messages`)
  console.log(`  verbatim window     : ${window.length} (sequences ${window[0].sequence}–${window[window.length - 1].sequence})`)
  console.log('\n  planted facts, and whether they are still visible verbatim:')
  for (const p of PLANTED) {
    const visible = window.some((t) => p.recallProbe.test(t.text))
    console.log(`    ${p.label.padEnd(28)} ${visible ? 'STILL VERBATIM (test is invalid)' : 'fell out of the window ✓'}`)
  }

  // ── Real summarisation ─────────────────────────────────────────────────────
  const plan = planSummary(all, { summary: null, summaryThroughSequence: 0 })
  if (plan.action !== 'summarise') {
    console.log('\n  ✗ no summary was planned — the conversation is not long enough')
    return
  }
  console.log(`\n  summarising ${plan.olderTurns.length} messages through sequence ${plan.upToSequence}…`)
  const summarised = await summariseConversation({
    agencyId: AGENCY_ID,
    previousSummary: null,
    olderTurns: plan.olderTurns,
    upToSequence: plan.upToSequence,
  })
  if (summarised.ok === false) {
    console.log(`  ✗ summarisation unavailable: ${'reason' in summarised ? summarised.reason : ''}`)
    return
  }

  console.log('\n' + '─'.repeat(78))
  console.log('THE SUMMARY THE MODEL PRODUCED')
  console.log('─'.repeat(78))
  console.log(summarised.summary)

  console.log('\n  does the summary retain each planted fact?')
  let retained = 0
  for (const p of PLANTED) {
    const kept = p.recallProbe.test(summarised.summary)
    if (kept) retained++
    console.log(`    ${p.label.padEnd(28)} ${kept ? 'retained ✓' : 'LOST ✗'}`)
  }
  // The correction is the one that matters most: the summary must carry 2019
  // and must NOT still assert 2018.
  const staleYear = /2018/.test(summarised.summary)
  console.log(`    correction applied           ${/2019/.test(summarised.summary) && !staleYear ? 'yes ✓' : staleYear ? 'STILL SAYS 2018 ✗' : 'no 2019 ✗'}`)

  // ── Real generation, with ONLY the summary + the recent window ──────────────
  const qTranscript = window.map((t) => ({ direction: t.direction, text: t.text }))
  const classified = classifySalesTurnFromTranscript(qTranscript)
  const lastInbound = qTranscript[qTranscript.length - 1].text
  const lang = detectLang(lastInbound)

  const gen = await generateQualifyTurn({
    agencyId: AGENCY_ID,
    transcript: qTranscript,
    qualification: {} as Qualification,
    collectFields: { required: [], optional: [] },
    guidance: GARAGE.guidance,
    businessIdentityBlock: formatBusinessIdentityBlock(GARAGE),
    productKnowledgeBlock: null,
    salesMove: classified.salesMove,
    salesStrategy: classified.salesStrategy,
    summaryBlock: formatSummaryBlock(summarised.summary),
    greetingLine: null,
    bypassAllowlist: true,
  })

  console.log('\n' + '─'.repeat(78))
  console.log('THE REPLY, GENERATED FROM SUMMARY + RECENT WINDOW ONLY')
  console.log('─'.repeat(78))
  if (gen.ok === false) {
    console.log(`  ✗ generation unavailable: ${gen.skipReason}`)
    return
  }
  console.log(`  customer asked : ${lastInbound}`)
  console.log(`  agent replied  : ${gen.reply}`)

  const validation = validateAutoResponse(gen.reply, {
    questionPolicy: questionPolicyForSalesMove(classified.salesMove),
    groundedFacts: groundedFactsFor(GARAGE),
  })
  console.log(`  validator      : ${validation.ok ? 'ok' : `REJECTED (${'violation' in validation ? validation.violation : ''})`}`)

  // The failure that matters: asking again for something already answered.
  const reAsks: Array<[RegExp, string]> = [
    [/איזה רכב|דגם|שנתון|איזו שנה/, 're-asked the car model/year'],
    [/מה התקלה|איזו תקלה|מה הבעיה/, 're-asked the fault'],
  ]
  const offences = reAsks.filter(([re]) => re.test(gen.reply)).map(([, label]) => label)
  console.log(`  re-asks        : ${offences.length ? `✗ ${offences.join('; ')}` : 'none ✓'}`)
  console.log(`  greeting       : ${/ברוך הבא/.test(gen.reply) ? '✗ GREETED AGAIN mid-conversation' : 'none ✓'}`)

  console.log('\n' + '═'.repeat(78))
  console.log(`VERDICT: ${retained}/${PLANTED.length} planted facts retained; re-asks: ${offences.length}`)
  console.log('═'.repeat(78))
  const merged = mergeQualification({}, gen.extracted, { corrected: gen.corrected })
  console.log(`structured memory after this turn: ${JSON.stringify(merged)}`)
}

void main()
