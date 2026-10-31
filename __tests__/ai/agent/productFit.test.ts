/**
 * Phase 3a — the agent is allowed to say the product is not worth it.
 *
 * WHY THIS IS A TRUST FEATURE AND NOT A COMMERCIAL ONE. "האם כדאי לי לשלם" is
 * asked by someone deciding whether to keep paying, and the answer they can
 * verify against their own experience is the only one worth giving. An agent
 * that always says yes is a sales rep wearing the assistant's clothes, and the
 * first time its "yes" is obviously wrong the rep stops believing everything
 * else it says — including the overdue follow-up it surfaces tomorrow.
 *
 * THE THREE OUTCOMES, all legitimate:
 *   positive        — real usage of the lead book is evidence of value.
 *   not enough      — an almost-empty system cannot prove value either way.
 *   honest negative — "לא בטוח שכדאי לך כרגע", stated as the hedged judgement
 *                     it is.
 *
 * WHAT STAYS FORBIDDEN, in both directions: ROI, revenue, conversion rate, time
 * saved and price. The agent has none of those numbers, and inventing one to
 * argue FOR the product is the same defect as inventing one to argue against it.
 */
import { describe, expect, it } from 'vitest'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { validateAgentAnswer } from '@/lib/agent/validate'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import type { AgentAnswer, BusinessState, Claim } from '@/lib/agent/types'
import type { EvidenceCollector } from '@/lib/agent/evidence'

const W = { from: 'T0', to: 'T0' }

/** An agency with a real, used lead book. */
function activeBusiness(): EvidenceCollector {
  const e = createEvidenceCollector()
  e.add({ kind: 'metric', metric: 'business.open_leads', window: W, n: 42 })
  e.add({ kind: 'metric', metric: 'business.new_this_week', window: W, n: 8 })
  e.add({ kind: 'metric', metric: 'health.follow_up_due_today', window: W, n: 5 })
  e.add({ kind: 'lead', refId: '161' })
  return e
}

/** An agency that has barely put anything in. */
function emptyBusiness(): EvidenceCollector {
  const e = createEvidenceCollector()
  e.add({ kind: 'metric', metric: 'business.total_leads', window: W, n: 1 })
  e.add({ kind: 'metric', metric: 'business.open_leads', window: W, n: 1 })
  return e
}

const answer = (claims: Claim[], businessState: BusinessState | null = null, unknown: string | null = null): AgentAnswer => ({
  headline: 'כותרת',
  claims,
  unknown,
  businessState,
})

// ─── Positive fit ───────────────────────────────────────────────────────────

describe('positive fit — real usage is the evidence', () => {
  it('accepts a product claim beside a measured usage observation', () => {
    const v = validateAgentAnswer(
      answer([
        { claimClass: 'PRODUCT', text: 'המערכת מרכזת את כל הלידים במקום אחד.', productEvidence: ['core_value'] },
        { claimClass: 'OBSERVATION', text: '42 לידים פתוחים מנוהלים במערכת, ו-8 נכנסו השבוע.', metricEvidence: ['business.open_leads', 'business.new_this_week'] },
        { claimClass: 'RECOMMENDATION', text: 'הייתי ממשיך, ומוודא שלכל ליד פתוח יש צעד הבא.', evidence: ['business.open_leads'] },
      ]),
      activeBusiness(),
    )
    expect(v?.claims.map((c) => c.claimClass)).toEqual(['PRODUCT', 'OBSERVATION', 'RECOMMENDATION'])
  })

  it('still refuses a positive claim dressed up with an invented number', () => {
    // Arguing FOR the product with a made-up metric is the same defect as
    // arguing against it with one.
    expect(
      validateAgentAnswer(
        answer([{ claimClass: 'OBSERVATION', text: 'המערכת שיפרה את שיעור ההמרה שלך.', metricEvidence: ['business.conversion_rate'] }]),
        activeBusiness(),
      ),
    ).toBeNull()
  })

  it('a PRODUCT claim cannot smuggle in an ROI figure as its evidence', () => {
    expect(
      validateAgentAnswer(
        answer([{ claimClass: 'PRODUCT', text: 'המערכת מחזירה את ההשקעה.', productEvidence: ['roi'] }]),
        activeBusiness(),
      ),
    ).toBeNull()
  })
})

// ─── Insufficient evidence ──────────────────────────────────────────────────

describe('insufficient evidence — the honest "I cannot tell yet"', () => {
  it('survives with no state and an explicit unknown', () => {
    const v = validateAgentAnswer(
      answer(
        [
          { claimClass: 'PRODUCT', text: 'המערכת נועדה לרכז לידים ולמנוע מהם ליפול בין הכיסאות.', productEvidence: ['core_value'] },
          { claimClass: 'OBSERVATION', text: 'יש ליד אחד בלבד במערכת.', metricEvidence: ['business.total_leads'] },
        ],
        null,
        'אין מספיק שימוש כדי לדעת אם המערכת משתלמת לך, ואין לי נתוני הכנסה או מחיר.',
      ),
      emptyBusiness(),
    )
    expect(v).not.toBeNull()
    expect(v!.businessState).toBeNull()
    expect(v!.unknown).toMatch(/אין מספיק שימוש/)
  })

  it('an almost-empty book cannot be talked into HEALTHY as a proxy for "worth it"', () => {
    // The whole-book read happened, but nothing measured survived, so the state
    // is withdrawn rather than becoming a reassurance about the purchase.
    const v = validateAgentAnswer(answer([], 'HEALTHY', 'אין מספיק שימוש כדי לדעת.'), emptyBusiness())
    expect(v!.businessState).toBeNull()
  })
})

// ─── Honest negative ────────────────────────────────────────────────────────

describe('honest negative — "לא בטוח שכדאי לך כרגע"', () => {
  it('survives validation as the hedged judgement it is', () => {
    const v = validateAgentAnswer(
      answer([
        { claimClass: 'OBSERVATION', text: 'יש ליד אחד בלבד במערכת.', metricEvidence: ['business.total_leads'] },
        {
          claimClass: 'INFERENCE',
          text: 'לא בטוח שכדאי לך לשלם כרגע — בלי לידים במערכת אין למה שהיא עושה על מה לפעול.',
          evidence: ['business.total_leads'],
        },
        {
          claimClass: 'RECOMMENDATION',
          text: 'הייתי מעלה קודם את הלידים הקיימים, ואז בודק שוב אם המערכת חוסכת לך עבודה.',
          evidence: ['business.total_leads'],
        },
      ]),
      emptyBusiness(),
    )
    expect(v?.claims.map((c) => c.claimClass)).toEqual(['OBSERVATION', 'INFERENCE', 'RECOMMENDATION'])
    expect(v!.claims[1]!.text).toMatch(/לא בטוח שכדאי לך/)
  })

  it('the same judgement stated as a certainty is dropped', () => {
    // The gate is about overstatement, not about the direction of the verdict.
    const v = validateAgentAnswer(
      answer([
        { claimClass: 'OBSERVATION', text: 'יש ליד אחד בלבד במערכת.', metricEvidence: ['business.total_leads'] },
        { claimClass: 'INFERENCE', text: 'המערכת לא משתלמת לך.', evidence: ['business.total_leads'] },
      ]),
      emptyBusiness(),
    )
    expect(v?.claims.map((c) => c.claimClass)).toEqual(['OBSERVATION'])
    expect(v!.diagnostics.dropped[0]!.reason).toBe('inference-not-hedged')
  })

  it('a negative verdict may not invent a price or a saving either', () => {
    expect(
      validateAgentAnswer(
        answer([{ claimClass: 'OBSERVATION', text: 'העלות לא מוצדקת.', metricEvidence: ['business.monthly_price'] }]),
        emptyBusiness(),
      ),
    ).toBeNull()
  })
})

// ─── The prompt asks for the behaviour ──────────────────────────────────────

describe('the prompt permits honesty and forbids selling', () => {
  it('names the fit question as MIXED', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/היא PRODUCT יחד עם BUSINESS_ADVICE, כלומר MIXED/)
  })

  it('says explicitly not to answer as a salesperson', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/ענה בכנות, לא כאיש מכירות/)
  })

  it('permits the negative conclusion in the exact words', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain('לא בטוח שכדאי לך כרגע')
  })

  it('treats non-use as evidence in the other direction, not as a reason to sell harder', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/ואי-שימוש הוא ראיה לכיוון השני/)
  })

  it('forbids inventing ROI, revenue, conversion, time saved or price', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אסור להמציא ROI, החזר השקעה, הכנסה, שיעור המרה, חיסכון בזמן או מחיר/)
    // A price may be stated only as the pricing_trial topic states it (lib/pricing.ts); any other figure is invented.
    expect(AGENT_SYSTEM_PROMPT).toMatch(/את המחיר ותנאי תקופת הניסיון מותר לומר רק כפי שהם כתובים בנושא pricing_trial/)
  })

  it('asks it to name what is missing rather than guess upward', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/במקום לנחש לכיוון החיובי/)
  })
})
