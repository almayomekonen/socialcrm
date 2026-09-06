/**
 * Phase 2.5 — the diagnosis, and the rule that keeps it honest.
 *
 * The agent used to stop at "nothing urgent today": true, useless, and the
 * difference between a dashboard and an advisor. `businessState` makes it commit
 * to a read, which is testable in a way prose is not.
 *
 * The rule that matters most here is the one that runs the other way. A surface
 * allowed to declare pressure is a surface that can manufacture it, and one false
 * alarm discounts every real signal afterwards — so URGENT and AT_RISK are
 * downgraded when nothing evidenced survives to support them.
 */
import { describe, expect, it } from 'vitest'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { validateAgentAnswer } from '@/lib/agent/validate'
import { agentAnswerSchema } from '@/lib/agent/answerSchema'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import { BUSINESS_STATES, type AgentAnswer, type BusinessState, type Claim } from '@/lib/agent/types'

function crm() {
  const e = createEvidenceCollector()
  e.add({ kind: 'lead', refId: '161' })
  e.add({ kind: 'metric', metric: 'health.no_next_step', window: { from: 'T0', to: 'T0' }, n: 25 })
  return e
}

const FACT: Claim = { claimClass: 'FACT', text: '25 לידים פתוחים בלי צעד הבא.', entityEvidence: ['lead:161'] }
const OBS: Claim = {
  claimClass: 'OBSERVATION',
  text: '25 לידים פתוחים בלי צעד הבא.',
  metricEvidence: ['health.no_next_step'],
}
const REC: Claim = { claimClass: 'RECOMMENDATION', text: 'הייתי מתחיל בחמישה החדשים.', evidence: ['lead:161'] }
const HEDGED: Claim = {
  claimClass: 'INFERENCE',
  text: 'ייתכן שהפער הוא במעקב ולא ברכישת לידים.',
  evidence: ['health.no_next_step'],
}

const answer = (claims: Claim[], businessState: BusinessState | null = null, unknown: string | null = null): AgentAnswer => ({
  headline: 'כותרת',
  claims,
  unknown,
  businessState,
})

// ─── The diagnosis is carried, and is one of four ───────────────────────────

describe('the agent commits to a business state', () => {
  it('offers exactly the four states, and null for a non-business question', () => {
    expect([...BUSINESS_STATES]).toEqual(['URGENT', 'AT_RISK', 'OPPORTUNITY', 'HEALTHY'])
    expect(validateAgentAnswer(answer([], null), crm())?.businessState).toBeNull()
  })

  it('carries a grounded state through validation', () => {
    expect(validateAgentAnswer(answer([OBS, REC], 'AT_RISK'), crm())?.businessState).toBe('AT_RISK')
    expect(validateAgentAnswer(answer([FACT], 'URGENT'), crm())?.businessState).toBe('URGENT')
  })

  it('rejects a state that is not one of the four', () => {
    expect(validateAgentAnswer({ ...answer([FACT]), businessState: 'PANIC' as never }, crm())).toBeNull()
    expect(agentAnswerSchema.safeParse({ ...answer([FACT]), businessState: 'PANIC' }).success).toBe(false)
  })

  it('tolerates an answer with no state field at all', () => {
    // An older payload must not be refused over a field it predates.
    const legacy = { headline: 'x', claims: [FACT], unknown: null } as AgentAnswer
    const v = validateAgentAnswer(legacy, crm())
    expect(v).not.toBeNull()
    expect(v!.businessState).toBeNull()
  })
})

// ─── Manufactured urgency is refused ────────────────────────────────────────

describe('pressure has to rest on something', () => {
  it('downgrades URGENT when every claim was destroyed', () => {
    const ungrounded = answer(
      [{ claimClass: 'FACT', text: 'הכול בוער.', entityEvidence: ['lead:99999'] }],
      'URGENT',
    )
    // The claim is dropped, so the answer is refused outright — and the state
    // could never reach the user in the first place.
    expect(validateAgentAnswer(ungrounded, crm())).toBeNull()
  })

  it('downgrades URGENT on an answer that asserted nothing at all', () => {
    // A greeting-shaped answer stamped URGENT. Nothing was dropped, so the
    // answer survives — the state must not.
    const v = validateAgentAnswer(answer([], 'URGENT'), crm())
    expect(v).not.toBeNull()
    expect(v!.businessState).toBeNull()
  })

  it('downgrades AT_RISK the same way', () => {
    expect(validateAgentAnswer(answer([], 'AT_RISK'), crm())?.businessState).toBeNull()
  })

  it('a recommendation alone cannot carry urgency', () => {
    // Advice is not a finding: "you should call people" is not evidence that
    // anything is wrong.
    expect(validateAgentAnswer(answer([REC], 'URGENT'), crm())?.businessState).toBeNull()
  })

  it('a hedged inference alone cannot carry urgency either', () => {
    expect(validateAgentAnswer(answer([HEDGED], 'AT_RISK'), crm())?.businessState).toBeNull()
  })

  it('but a single evidenced finding is enough', () => {
    expect(validateAgentAnswer(answer([OBS, REC], 'URGENT'), crm())?.businessState).toBe('URGENT')
  })
})

// ─── OPPORTUNITY stays calm; HEALTHY became a claim ─────────────────────────

describe('OPPORTUNITY survives a thin answer — HEALTHY no longer does', () => {
  it('keeps OPPORTUNITY with no claims — it asserts no problem', () => {
    expect(validateAgentAnswer(answer([], 'OPPORTUNITY'), crm())?.businessState).toBe('OPPORTUNITY')
  })

  it('downgrades HEALTHY on an honest "I found nothing"', () => {
    /**
     * CHANGED IN PHASE 3a, deliberately reversing what this test used to pin.
     *
     * It previously asserted HEALTHY survived here, on the reasoning that "I
     * found nothing" is an honest finding worth keeping. It is honest — but
     * `businessState` is rendered as a verdict on the BUSINESS, and "I did not
     * find a problem" is not "there is no problem". The prose stays; the label
     * does not. See lib/agent/businessState.ts.
     */
    const v = validateAgentAnswer(answer([], 'HEALTHY', 'לא מצאתי בעיה ולא הזדמנות מבוססת.'), crm())
    expect(v).not.toBeNull()
    expect(v!.businessState).toBeNull()
    // Only the label was wrong — the honest explanation reaches the rep intact.
    expect(v!.unknown).toMatch(/לא מצאתי/)
  })

  it('keeps OPPORTUNITY alongside a grounded recommendation', () => {
    const v = validateAgentAnswer(answer([OBS, REC], 'OPPORTUNITY'), crm())
    expect(v?.businessState).toBe('OPPORTUNITY')
    expect(v?.claims.map((c) => c.claimClass)).toEqual(['OBSERVATION', 'RECOMMENDATION'])
  })
})

// ─── The evidence gate is untouched ─────────────────────────────────────────

describe('nothing about grounding relaxed', () => {
  it('a recommendation is still not a factual claim, and still cites', () => {
    const v = validateAgentAnswer(answer([OBS, REC], 'AT_RISK'), crm())
    expect(v?.claims).toHaveLength(2)
    // Ungrounded advice is still dropped.
    expect(
      validateAgentAnswer(
        answer([{ claimClass: 'RECOMMENDATION', text: 'תעשה משהו.', evidence: ['lead:99999'] }], 'OPPORTUNITY'),
        crm(),
      ),
    ).toBeNull()
  })

  it('an invented financial metric is still refused', () => {
    for (const metric of ['revenue', 'conversion_rate', 'roi', 'ltv']) {
      expect(
        validateAgentAnswer(
          answer([{ claimClass: 'OBSERVATION', text: 'מספר', metricEvidence: [metric] }], 'AT_RISK'),
          crm(),
        ),
        metric,
      ).toBeNull()
    }
  })

  it('a product claim still needs no CRM evidence and carries no state', () => {
    const v = validateAgentAnswer(
      answer([{ claimClass: 'PRODUCT', text: 'המערכת מרכזת לידים.', productEvidence: ['core_value'] }], null),
      createEvidenceCollector(),
    )
    expect(v?.claims).toHaveLength(1)
    expect(v?.businessState).toBeNull()
  })
})

// ─── The instruction actually asks for the behaviour ────────────────────────

describe('the prompt asks for a decision, not a report', () => {
  it('names all four states', () => {
    for (const state of BUSINESS_STATES) expect(AGENT_SYSTEM_PROMPT).toContain(state)
  })

  it('separates "nothing urgent" from "nothing to do"', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/"אין דחוף" זה לא "אין מה לעשות"/)
  })

  it('asks for ONE dominant recommendation', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/המלצה אחת ראשית/)
  })

  it('forbids manufactured urgency in words as well as in code', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/בלי דחיפות מזויפת/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/זה לא דחוף, אבל זה מה שהייתי משפר ראשון/)
  })

  it('forbids inventing financial outcomes', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אין לך נתוני הכנסה, שיעור המרה, ROI/)
  })

  it('permits disagreeing with the owner', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/מותר לך לחלוק על המשתמש/)
  })

  it('forbids inventing an opportunity to sound proactive', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תמציא הזדמנות רק כדי להישמע יוזם/)
  })

  it('does not force the four-section shape onto simple questions', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תכפה את המבנה הזה על שאלה פשוטה/)
  })

  it('stays read-only — no write verb is offered anywhere', () => {
    // The agent recommends actions; it never claims to take them.
    for (const forbidden of ['create_task', 'set_followup', 'update_lead', 'send_whatsapp', 'assign_lead']) {
      expect(AGENT_SYSTEM_PROMPT).not.toContain(forbidden)
    }
  })
})
