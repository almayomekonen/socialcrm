/**
 * The evidence citation contract.
 *
 * A live 21-question run destroyed 40 claims — every FACT and RECOMMENDATION
 * naming a lead — because tools returned `leadId: 161`, the collector keyed the
 * evidence on `"161"`, and the model cited `"lead:161"`. OBSERVATIONs survived
 * only because a metric is cited by a bare name that happens to match.
 *
 * These pin BOTH halves of the fix: the canonical form now resolves, and it does
 * so without loosening grounding. The strictness cases matter more than the
 * happy path — the failure mode a permissive fix would introduce is silent, and
 * would let a claim about one entity be "supported" by another.
 */
import { describe, expect, it } from 'vitest'
import { createEvidenceCollector, entityRef, parseEntityRef } from '@/lib/agent/evidence'
import { validateAgentAnswer } from '@/lib/agent/validate'
import type { AgentAnswer } from '@/lib/agent/types'

function collector() {
  const e = createEvidenceCollector()
  e.add({ kind: 'lead', refId: '161' })
  e.add({ kind: 'message', refId: '42' })
  e.add({ kind: 'metric', metric: 'today.total', window: { from: 'T0', to: 'T0' }, n: 8 })
  return e
}

const fact = (refs: string[]): AgentAnswer => ({
  headline: 'כותרת',
  claims: [{ claimClass: 'FACT', text: 'דוד ממתין למענה.', entityEvidence: refs }],
  unknown: null,
})

// ─── Canonical form ─────────────────────────────────────────────────────────

describe('canonical reference format', () => {
  it('builds the form the model is told to copy', () => {
    expect(entityRef('lead', 161)).toBe('lead:161')
    expect(entityRef('message', '42')).toBe('message:42')
  })

  it('parses a qualified reference into kind and id', () => {
    expect(parseEntityRef('lead:161')).toEqual({ kind: 'lead', id: '161' })
    expect(parseEntityRef('message:42')).toEqual({ kind: 'message', id: '42' })
  })

  it('refuses to parse anything that is not a known entity kind', () => {
    // Returning `{id: '161'}` here is exactly the permissive bug this guards:
    // it would make `customer:161` resolve on its digits.
    expect(parseEntityRef('customer:161')).toBeNull()
    expect(parseEntityRef('161')).toBeNull()
    expect(parseEntityRef(':161')).toBeNull()
    expect(parseEntityRef('lead:')).toBeNull()
  })
})

// ─── Resolution ─────────────────────────────────────────────────────────────

describe('both accepted forms resolve to the same evidence', () => {
  it('accepts the bare id', () => {
    expect(validateAgentAnswer(fact(['161']), collector())).not.toBeNull()
  })

  it('accepts the canonical id — the form the live run produced and lost', () => {
    expect(validateAgentAnswer(fact(['lead:161']), collector())).not.toBeNull()
  })

  it('treats them as the same claim, not two', () => {
    const bare = validateAgentAnswer(fact(['161']), collector())
    const canonical = validateAgentAnswer(fact(['lead:161']), collector())
    expect(bare?.claims).toHaveLength(1)
    expect(canonical?.claims).toHaveLength(1)
  })
})

// ─── Strictness ─────────────────────────────────────────────────────────────

describe('grounding did not loosen', () => {
  it('a nonexistent lead id does not resolve', () => {
    expect(validateAgentAnswer(fact(['lead:999']), collector())).toBeNull()
    expect(validateAgentAnswer(fact(['999']), collector())).toBeNull()
  })

  it('an invented entity kind does not resolve on its digits', () => {
    expect(validateAgentAnswer(fact(['customer:161']), collector())).toBeNull()
  })

  it('a qualified ref is checked against ITS OWN kind only', () => {
    // The collector holds message 42 and lead 161 — never lead 42 or message 161.
    // If the prefix were stripped and all kinds tried, both of these would pass.
    expect(validateAgentAnswer(fact(['lead:42']), collector())).toBeNull()
    expect(validateAgentAnswer(fact(['message:161']), collector())).toBeNull()
  })

  it('a metric name cannot ground a FACT, in either form', () => {
    expect(validateAgentAnswer(fact(['today.total']), collector())).toBeNull()
    expect(validateAgentAnswer(fact(['lead:today.total']), collector())).toBeNull()
  })

  it('an empty citation still fails', () => {
    expect(validateAgentAnswer(fact([]), collector())).toBeNull()
  })
})

// ─── Existing evidence is untouched ─────────────────────────────────────────

describe('non-entity evidence continues to work unchanged', () => {
  const observation = (refs: string[]): AgentAnswer => ({
    headline: 'כותרת',
    claims: [{ claimClass: 'OBSERVATION', text: 'נותרו 8 פריטים.', metricEvidence: refs }],
    unknown: null,
  })

  it('a metric resolves by its bare name', () => {
    expect(validateAgentAnswer(observation(['today.total']), collector())).not.toBeNull()
  })

  it('an unknown metric does not', () => {
    expect(validateAgentAnswer(observation(['today.invented']), collector())).toBeNull()
  })

  it('an entity ref cannot ground an OBSERVATION, in either form', () => {
    expect(validateAgentAnswer(observation(['161']), collector())).toBeNull()
    expect(validateAgentAnswer(observation(['lead:161']), collector())).toBeNull()
  })

  it('a message reference still grounds a FACT in both forms', () => {
    expect(validateAgentAnswer(fact(['42']), collector())).not.toBeNull()
    expect(validateAgentAnswer(fact(['message:42']), collector())).not.toBeNull()
  })
})

// ─── Agency isolation ───────────────────────────────────────────────────────

describe('agency isolation', () => {
  it('a lead this investigation never read cannot be cited, however it is written', () => {
    // The collector is built per investigation and written ONLY by tools that
    // closed over one server-resolved agency. A lead belonging to another agency
    // is therefore simply absent — there is no form of the reference that
    // reaches it, which is what makes the canonical form safe to accept.
    const otherAgencyLead = '7777'
    for (const ref of [otherAgencyLead, `lead:${otherAgencyLead}`]) {
      expect(validateAgentAnswer(fact([ref]), collector()), ref).toBeNull()
    }
  })

  it('an empty collector supports nothing at all', () => {
    const empty = createEvidenceCollector()
    expect(validateAgentAnswer(fact(['lead:161']), empty)).toBeNull()
    expect(validateAgentAnswer(fact(['161']), empty)).toBeNull()
  })
})
