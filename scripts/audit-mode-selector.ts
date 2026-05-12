/**
 * audit-mode-selector.ts — temporary CLI audit harness.
 *
 * Fires one ask-question prompt per Copilot mode (fast / smart / advanced)
 * directly against `runStructured`, exercising the same router boundary the
 * `askLeadQuestion` server action uses. Captures provider, model, latency,
 * answer length, and fallback chain per mode and prints a comparison table.
 *
 * Auth is bypassed (`bypassAllowlist: true`) the same way `evaluate-lead-
 * intelligence.ts` does, so we don't need to fake `requireAgencyUser`.
 *
 * Reads ANTHROPIC/GOOGLE/OPENAI keys from .env.local. Set AI_TRACE=1 to also
 * see the [AI REQUEST] / [AI ROUTER] / [FALLBACK] tags emitted by the
 * temporary debug logging in router.ts and leadAskQuestion.ts.
 *
 * Cost: ~3-9 calls (mode × providers in chain), prompts capped to a few
 * hundred tokens. Pennies.
 *
 * REMOVE this file once the mode-selector audit is signed off.
 */
import { runStructured } from '../lib/ai/router'
import { getProviderChain } from '../lib/ai/providers'
import {
  COPILOT_MODES,
  resolveCopilotModeRole,
  type CopilotModeId,
} from '../lib/ai/copilotModes'
import {
  LEAD_ASK_QUESTION_SYSTEM_PROMPT,
  LeadAskAnswerSchema,
} from '../lib/ai/prompts/leadAskQuestion'
import { db } from '../config/db'

const QUESTION =
  'נציג קיבל את הליד הזה לפני 5 ימים. עברו 3 ימים בלי משימה פתוחה ובלי תיעוד שיחה. מה הצעד הבא הכי נכון השבוע?'

const PROMPT_USER = `נתוני הליד (JSON):
${JSON.stringify(
  {
    'שם הליד': 'דני כהן',
    סטטוס: 'בטיפול',
    'מקור הליד': 'instagram',
    'ימים מהיצירה': 5,
    'ימים בסטטוס נוכחי': 5,
    'ימים מאינטראקציה אחרונה': 3,
    'מצב הטיפול': 'פעיל',
    'דחיפות במעקב': 'בינוני',
    'משימות באיחור': 0,
    'מטפל בליד': 'אלמיו',
    'ערוץ קשר: טלפון': true,
  },
  null,
  2,
)}

השאלה של הנציג:
${QUESTION}

החזר אובייקט לפי הסכמה.`

type ModeResult = {
  mode: CopilotModeId
  role: string
  expectedChain: string[]
  actualProvider: string | null
  actualModel: string | null
  fallbackUsed: boolean
  latencyMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  answerChars: number | null
  confidence: string | null
  failure?: { reason: string; message?: string }
}

function describeChain(role: string): string[] {
  return getProviderChain(role as Parameters<typeof getProviderChain>[0]).map(
    (h) => `${h.provider}:${h.modelId}`,
  )
}

async function runOne(modeId: CopilotModeId): Promise<ModeResult> {
  const role = resolveCopilotModeRole(modeId)
  const expectedChain = describeChain(role)
  const t0 = Date.now()

  const out = await runStructured({
    kind: 'lead.askQuestion',
    schema: LeadAskAnswerSchema,
    schemaName: 'LeadAskAnswer',
    schemaDescription: 'תשובה תפעולית לשאלת הנציג על ליד יחיד',
    system: LEAD_ASK_QUESTION_SYSTEM_PROMPT,
    user: PROMPT_USER,
    leadId: null,
    agencyId: 27, // test agency
    bypassAllowlist: true,
    roleOverride: role,
  })

  const latencyMs = Date.now() - t0

  if (out.ok === false) {
    return {
      mode: modeId,
      role,
      expectedChain,
      actualProvider: null,
      actualModel: null,
      fallbackUsed: false,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      answerChars: null,
      confidence: null,
      failure: { reason: out.reason, message: out.message },
    }
  }

  const expectedFirstProvider = expectedChain[0]?.split(':')[0] ?? null
  const actualKey = `${out.provider}:${out.model}`
  const fallbackUsed = expectedFirstProvider !== null && expectedFirstProvider !== out.provider

  return {
    mode: modeId,
    role,
    expectedChain,
    actualProvider: out.provider,
    actualModel: out.model,
    fallbackUsed,
    latencyMs: out.latencyMs,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    costUsd: out.costUsd,
    answerChars: out.data.answer.length,
    confidence: out.data.confidence,
    // Suppress unused-var lint
    ...(actualKey ? {} : {}),
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n)
  return s + ' '.repeat(n - s.length)
}

function printRow(cells: string[], widths: number[]) {
  console.log(cells.map((c, i) => pad(c, widths[i])).join(' │ '))
}

async function run() {
  console.log('AI mode-selector audit — one ask-question call per mode')
  console.log('=========================================================')

  const results: ModeResult[] = []
  for (const mode of COPILOT_MODES) {
    console.log(`\n--- Running mode="${mode.id}" (role=${mode.role}) ---`)
    console.log(`  expected chain: ${describeChain(mode.role).join(' → ')}`)
    const r = await runOne(mode.id)
    results.push(r)
    if (r.failure) {
      console.log(`  FAILED: reason=${r.failure.reason} msg=${r.failure.message ?? ''}`)
    } else {
      console.log(
        `  served by: ${r.actualProvider}:${r.actualModel} (latency ${r.latencyMs}ms, fallback=${r.fallbackUsed})`,
      )
      console.log(`  answer chars: ${r.answerChars}, confidence: ${r.confidence}`)
    }
  }

  console.log('\n\nSUMMARY')
  console.log('=========================================================')
  const widths = [10, 9, 16, 28, 9, 9, 11]
  printRow(['mode', 'role', 'served-provider', 'served-model', 'latency', 'fallback', 'answerChars'], widths)
  printRow(['-'.repeat(widths[0]), '-'.repeat(widths[1]), '-'.repeat(widths[2]), '-'.repeat(widths[3]), '-'.repeat(widths[4]), '-'.repeat(widths[5]), '-'.repeat(widths[6])], widths)
  for (const r of results) {
    printRow(
      [
        r.mode,
        r.role,
        r.actualProvider ?? '(none)',
        r.actualModel ?? '(none)',
        `${r.latencyMs}ms`,
        String(r.fallbackUsed),
        String(r.answerChars ?? '-'),
      ],
      widths,
    )
  }

  // Behavioral-difference snapshot — answer length is a cheap proxy for
  // "shorter / balanced / deeper". A real eval would diff content quality;
  // we just want a rough signal here.
  console.log('\nBehavioural delta (answer length):')
  for (const r of results) {
    if (r.answerChars != null) {
      console.log(`  ${r.mode.padEnd(10)} → ${r.answerChars} chars / ${r.outputTokens} out tokens / ${r.latencyMs}ms`)
    }
  }

  await db.destroy()
}

run().catch(async (err) => {
  console.error(err)
  try {
    await db.destroy()
  } catch {}
  process.exit(1)
})
