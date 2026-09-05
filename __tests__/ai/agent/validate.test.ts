import { describe, expect, it } from 'vitest'
import { validateAgentAnswerDetailed, validateAgentAnswer, HEDGE_MARKERS } from '@/lib/agent/validate'
import { createEvidenceCollector, type EvidenceCollector } from '@/lib/agent/evidence'
import type { AgentAnswer, Claim } from '@/lib/agent/types'

/**
 * The Agent trust boundary.
 *
 * These pin the property that makes the whole slice trustworthy: a claim
 * survives only if the evidence it names actually exists, in the KIND its class
 * requires. Relabelling an inference as a fact is not a rename here — it means
 * moving refs into `entityEvidence` and having them resolve as entities, which
 * the validator checks.
 *
 * Deterministic, database-free.
 */

function collector(): EvidenceCollector {
  const c = createEvidenceCollector()
  c.add({ kind: 'lead', refId: '15015' })
  c.add({ kind: 'conversation', refId: '991' })
  c.add({ kind: 'message', refId: '5001' })
  c.add({ kind: 'metric', metric: 'today.total', window: { from: 'a', to: 'b' }, n: 3 })
  c.add({ kind: 'metric', metric: 'today.remaining', window: { from: 'a', to: 'b' }, n: 3 })
  return c
}

const answer = (claims: Claim[], over: Partial<AgentAnswer> = {}): AgentAnswer => ({
  headline: 'שלוש פניות ממתינות למענה.',
  claims,
  unknown: null,
  ...over,
})

const FACT: Claim = { claimClass: 'FACT', text: 'דנה ממתינה שלושה ימים.', entityEvidence: ['15015'] }
const OBSERVATION: Claim = {
  claimClass: 'OBSERVATION',
  text: 'שלוש פניות ממתינות בחלון הנוכחי.',
  metricEvidence: ['today.total'],
}
const INFERENCE: Claim = {
  claimClass: 'INFERENCE',
  text: 'ייתכן שהעיכוב מרוכז בפניות הערב.',
  evidence: ['15015'],
}
const RECOMMENDATION: Claim = {
  claimClass: 'RECOMMENDATION',
  text: 'התחל עם דנה, היא הממתינה הכי הרבה זמן.',
  evidence: ['15015'],
}

// ─── FACT ───────────────────────────────────────────────────────────────────

describe('FACT — requires entity evidence', () => {
  it('1. keeps a fact citing a real entity', () => {
    const out = validateAgentAnswer(answer([FACT]), collector())
    expect(out?.claims).toHaveLength(1)
    expect(out?.claims[0].claimClass).toBe('FACT')
  })

  it('2. drops a fact with no evidence at all', () => {
    const out = validateAgentAnswer(answer([{ ...FACT, entityEvidence: [] }, RECOMMENDATION]), collector())
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['RECOMMENDATION'])
    expect(out?.diagnostics.dropped[0].reason).toBe('no-valid-evidence')
  })

  it('3. drops a fact whose evidence does not exist', () => {
    const out = validateAgentAnswer(answer([{ ...FACT, entityEvidence: ['99999'] }, RECOMMENDATION]), collector())
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['RECOMMENDATION'])
  })

  it('4. drops a fact that cites only a metric — a measurement is not a source row', () => {
    const out = validateAgentAnswer(
      answer([{ ...FACT, entityEvidence: ['today.total'] }, RECOMMENDATION]),
      collector(),
    )
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['RECOMMENDATION'])
    expect(out?.diagnostics.dropped[0].reason).toBe('no-valid-evidence')
  })

  it('accepts any entity kind — conversation and message count too', () => {
    const out = validateAgentAnswer(
      answer([
        { ...FACT, entityEvidence: ['991'] },
        { ...FACT, text: 'הודעה אחרונה נכנסה אתמול.', entityEvidence: ['5001'] },
      ]),
      collector(),
    )
    expect(out?.claims).toHaveLength(2)
  })
})

// ─── OBSERVATION ────────────────────────────────────────────────────────────

describe('OBSERVATION — requires metric evidence', () => {
  it('5. keeps an observation citing a real metric', () => {
    const out = validateAgentAnswer(answer([OBSERVATION]), collector())
    expect(out?.claims).toHaveLength(1)
  })

  it('6. drops an observation with no metric', () => {
    const out = validateAgentAnswer(answer([{ ...OBSERVATION, metricEvidence: [] }, FACT]), collector())
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['FACT'])
  })

  it('7. drops an observation naming a metric the collector never produced', () => {
    const out = validateAgentAnswer(
      answer([{ ...OBSERVATION, metricEvidence: ['today.invented'] }, FACT]),
      collector(),
    )
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['FACT'])
  })

  it('drops an observation that cites an entity instead of a metric', () => {
    const out = validateAgentAnswer(answer([{ ...OBSERVATION, metricEvidence: ['15015'] }, FACT]), collector())
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['FACT'])
  })
})

// ─── INFERENCE ──────────────────────────────────────────────────────────────

describe('INFERENCE — requires evidence AND a hedge', () => {
  it('8. keeps a hedged, grounded inference', () => {
    const out = validateAgentAnswer(answer([INFERENCE]), collector())
    expect(out?.claims).toHaveLength(1)
  })

  it('9. drops an inference with no evidence, however well hedged', () => {
    const out = validateAgentAnswer(answer([{ ...INFERENCE, evidence: [] }, FACT]), collector())
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['FACT'])
    expect(out?.diagnostics.dropped[0].reason).toBe('no-valid-evidence')
  })

  it('10. drops an inference written as a bare assertion', () => {
    const out = validateAgentAnswer(
      answer([{ ...INFERENCE, text: 'העיכוב נובע מזמני התגובה בערב.' }, FACT]),
      collector(),
    )
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['FACT'])
    expect(out?.diagnostics.dropped[0].reason).toBe('inference-not-hedged')
  })

  it('11. drops a hedged inference whose evidence does not exist', () => {
    const out = validateAgentAnswer(answer([{ ...INFERENCE, evidence: ['99999'] }, FACT]), collector())
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['FACT'])
  })

  it('accepts a metric as grounding for an inference', () => {
    const out = validateAgentAnswer(answer([{ ...INFERENCE, evidence: ['today.total'] }]), collector())
    expect(out?.claims).toHaveLength(1)
  })

  it('every declared hedge marker is actually accepted', () => {
    for (const marker of HEDGE_MARKERS) {
      const out = validateAgentAnswer(
        answer([{ claimClass: 'INFERENCE', text: `${marker} משהו קורה כאן.`, evidence: ['15015'] }]),
        collector(),
      )
      expect(out?.claims, `marker "${marker}" must be accepted`).toHaveLength(1)
    }
  })
})

// ─── RECOMMENDATION ─────────────────────────────────────────────────────────

describe('RECOMMENDATION — advice, but still grounded', () => {
  it('12. keeps a grounded recommendation without requiring a hedge', () => {
    const out = validateAgentAnswer(answer([RECOMMENDATION]), collector())
    expect(out?.claims).toHaveLength(1)
  })

  it('13. drops a recommendation with no evidence', () => {
    const out = validateAgentAnswer(answer([{ ...RECOMMENDATION, evidence: [] }, FACT]), collector())
    expect(out?.claims.map((c) => c.claimClass)).toEqual(['FACT'])
  })
})

// ─── Repair: dedupe and strip ───────────────────────────────────────────────

describe('repair before rejection', () => {
  it('14. dedupes repeated refs inside one claim', () => {
    const out = validateAgentAnswer(
      answer([{ ...FACT, entityEvidence: ['15015', '15015', '15015'] }]),
      collector(),
    )
    const kept = out?.claims[0]
    expect(kept && kept.claimClass === 'FACT' ? kept.entityEvidence : []).toEqual(['15015'])
  })

  it('15. strips nonexistent refs and keeps the claim if a real one survives', () => {
    const out = validateAgentAnswer(
      answer([{ ...FACT, entityEvidence: ['99999', '15015', '88888'] }]),
      collector(),
    )
    const kept = out?.claims[0]
    expect(kept && kept.claimClass === 'FACT' ? kept.entityEvidence : []).toEqual(['15015'])
    expect(out?.diagnostics.strippedRefs).toEqual([{ text: FACT.text, removed: ['99999', '88888'] }])
  })

  it('20. normalizes a refId= prefix the model may echo', () => {
    const out = validateAgentAnswer(
      answer([{ ...FACT, entityEvidence: ['refId=15015'] }]),
      collector(),
    )
    const kept = out?.claims[0]
    expect(kept && kept.claimClass === 'FACT' ? kept.entityEvidence : []).toEqual(['15015'])
  })

  it('trims surrounding whitespace on a ref', () => {
    const out = validateAgentAnswer(answer([{ ...FACT, entityEvidence: ['  15015  '] }]), collector())
    expect(out?.claims).toHaveLength(1)
  })
})

// ─── Whole-answer rejection ─────────────────────────────────────────────────

describe('whole-answer rejection', () => {
  it('16. rejects the answer when the prose carries an unsupported business claim', () => {
    expect(validateAgentAnswer(answer([FACT], { headline: 'דנה היא ליד חם.' }), collector())).toBeNull()
  })

  it('16b. rejects when the unsupported claim is inside a claim body', () => {
    expect(
      validateAgentAnswer(answer([{ ...FACT, text: 'יש סיכוי גבוה לסגירה.' }]), collector()),
    ).toBeNull()
  })

  it('16c. rejects when the unsupported claim is in the unknown field', () => {
    expect(validateAgentAnswer(answer([FACT], { unknown: 'לא ברור אם הליד חם' }), collector())).toBeNull()
  })

  it('17. rejects a malformed answer', () => {
    expect(validateAgentAnswer(null as unknown as AgentAnswer, collector())).toBeNull()
    expect(validateAgentAnswer({ claims: [FACT] } as unknown as AgentAnswer, collector())).toBeNull()
    expect(validateAgentAnswer(answer([{ claimClass: 'NOPE' } as unknown as Claim]), collector())).toBeNull()
  })

  it('18. ACCEPTS a claimless answer for an interactive question', () => {
    // Changed deliberately. A model that proposed nothing destroyed nothing, so
    // there is no unsupported statement to hide — this is a greeting, or an
    // honest "I cannot determine that". Refusing it discarded four correct
    // explanations in a live run and showed a generic error instead.
    expect(validateAgentAnswer(answer([]), collector())).not.toBeNull()
    // A malformed answer is still malformed: no headline, no answer.
    expect(validateAgentAnswer(answer([], { headline: '' }), collector())).toBeNull()
  })

  it('18b. still refuses a claimless answer on the autonomous path', () => {
    // There the system already knows an expectation was violated, so a finding
    // that asserts nothing is not a finding.
    const v = validateAgentAnswerDetailed(answer([]), collector(), { requireClaim: true })
    expect(v.answer).toBeNull()
    expect(v.rejection).toBe('no-supportable-claim')
  })

  it('rejects when nothing survives validation — never rescues', () => {
    expect(validateAgentAnswer(answer([{ ...FACT, entityEvidence: ['99999'] }]), collector())).toBeNull()
  })

  it('rejects against an empty collector — no tool ran, nothing is citable', () => {
    expect(validateAgentAnswer(answer([FACT]), createEvidenceCollector())).toBeNull()
  })
})

// ─── Namespace separation ───────────────────────────────────────────────────

describe('19. entity and metric namespaces are separate', () => {
  it('a metric name never satisfies an entity requirement', () => {
    expect(
      validateAgentAnswer(answer([{ ...FACT, entityEvidence: ['today.remaining'] }]), collector()),
    ).toBeNull()
  })

  it('an entity refId never satisfies a metric requirement', () => {
    expect(
      validateAgentAnswer(answer([{ ...OBSERVATION, metricEvidence: ['5001'] }]), collector()),
    ).toBeNull()
  })

  it('an id that exists in BOTH namespaces resolves per the claim class', () => {
    const c = createEvidenceCollector()
    c.add({ kind: 'lead', refId: 'today.total' })
    c.add({ kind: 'metric', metric: 'today.total', window: { from: 'a', to: 'b' }, n: 1 })
    expect(validateAgentAnswer(answer([{ ...FACT, entityEvidence: ['today.total'] }]), c)?.claims).toHaveLength(1)
    expect(validateAgentAnswer(answer([{ ...OBSERVATION, metricEvidence: ['today.total'] }]), c)?.claims).toHaveLength(1)
  })
})

// ─── Authorship ─────────────────────────────────────────────────────────────

describe('21. AI/human authorship cannot be asserted', () => {
  it('a claim about who wrote an outbound message has no evidence kind to cite', () => {
    // B3 exposes `direction` only — there is no authorship evidence in the
    // collector, so such a claim can only cite a message id, and the prose is
    // the model's own. The validator cannot read intent; what it CAN guarantee
    // is that no authorship evidence kind exists to make the claim citable.
    const c = collector()
    expect(c.has('message', '5001')).toBe(true)
    // There is no 'author' evidence kind in the model at all.
    expect(c.all().every((r) => r.kind !== ('author' as never))).toBe(true)
  })

  it('an authorship claim still requires real evidence like any other', () => {
    const out = validateAgentAnswer(
      answer([{ claimClass: 'FACT', text: 'הנציג ענה אתמול.', entityEvidence: ['99999'] }]),
      collector(),
    )
    expect(out).toBeNull()
  })
})

// ─── Diagnostics ────────────────────────────────────────────────────────────

describe('diagnostics are developer-only and complete', () => {
  it('records every drop with its reason', () => {
    const out = validateAgentAnswer(
      answer([
        FACT,
        { ...FACT, text: 'לא מבוסס.', entityEvidence: ['99999'] },
        { ...INFERENCE, text: 'זה נובע מהערב.' },
      ]),
      collector(),
    )
    expect(out?.diagnostics.dropped).toEqual([
      { text: 'לא מבוסס.', reason: 'no-valid-evidence' },
      { text: 'זה נובע מהערב.', reason: 'inference-not-hedged' },
    ])
  })

  it('preserves headline and unknown verbatim', () => {
    const out = validateAgentAnswer(answer([FACT], { unknown: 'אין נתוני המרה.' }), collector())
    expect(out?.headline).toBe('שלוש פניות ממתינות למענה.')
    expect(out?.unknown).toBe('אין נתוני המרה.')
  })
})
