import { describe, expect, it } from 'vitest'
import { zodSchema } from 'ai'
import { agentAnswerSchema, agentClaimSchema } from '@/lib/agent/answerSchema'
import type { AgentAnswer } from '@/lib/agent/types'

/**
 * The Agent answer schema is a PROVIDER CONTRACT, not just a shape.
 *
 * It reaches OpenAI as `response_format` and is validated there before any
 * inference runs, so a schema OpenAI rejects is a total outage of the surface —
 * exactly what production hit: every request failed at steps=0 with
 * "In context=('properties','claims','items'), 'oneOf' is not permitted",
 * because zod emits `oneOf` for a discriminated union.
 *
 * These tests assert the JSON Schema the SDK ACTUALLY SENDS — `zodSchema(...)`,
 * the same conversion `Output.object` performs — rather than raw
 * `z.toJSONSchema`, because the SDK adds `additionalProperties` on the way and
 * only the post-conversion document is what OpenAI sees.
 */

const emitted = () => zodSchema(agentAnswerSchema).jsonSchema as Record<string, unknown>

/** Every nested object in the document, so the constraints are checked everywhere. */
function objectNodes(node: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const n of node) objectNodes(n, acc)
    return acc
  }
  const o = node as Record<string, unknown>
  if (o.type === 'object' && o.properties) acc.push(o)
  for (const v of Object.values(o)) objectNodes(v, acc)
  return acc
}

describe('emitted JSON Schema is OpenAI Structured Outputs compatible', () => {
  // REGRESSION: this is the exact production failure. If claims.items ever emits
  // `oneOf` again, every OpenAI investigation fails at step 0.
  it('never emits oneOf anywhere — the rejection that broke production', () => {
    expect(JSON.stringify(emitted())).not.toContain('"oneOf"')
  })

  it('expresses the claim union as anyOf at properties.claims.items', () => {
    const js = emitted() as { properties: { claims: { items: Record<string, unknown> } } }
    const items = js.properties.claims.items
    expect(Object.keys(items)).toContain('anyOf')
    expect(Object.keys(items)).not.toContain('oneOf')
    expect((items.anyOf as unknown[]).length).toBe(5)
  })

  it('sets additionalProperties:false on every object', () => {
    const objs = objectNodes(emitted())
    expect(objs.length).toBeGreaterThanOrEqual(5)
    for (const o of objs) expect(o.additionalProperties).toBe(false)
  })

  it('lists every property in required, on every object', () => {
    for (const o of objectNodes(emitted())) {
      const props = Object.keys(o.properties as Record<string, unknown>).sort()
      const required = ([...((o.required as string[]) ?? [])]).sort()
      expect(required).toEqual(props)
    }
  })
})

describe('the five claim variants remain structurally distinct', () => {
  it('each variant keeps its own claimClass literal and evidence field name', () => {
    const js = emitted() as { properties: { claims: { items: { anyOf: Record<string, never>[] } } } }
    const shapes = js.properties.claims.items.anyOf.map((v) => {
      const props = v.properties as unknown as Record<string, { const?: string }>
      return {
        claimClass: props.claimClass?.const,
        evidenceField: Object.keys(props).find((k) => k !== 'claimClass' && k !== 'text'),
      }
    })
    // PRODUCT carries its OWN field name for the same reason every other class
    // does: relabelling a CRM fact as product knowledge has to cost moving refs
    // into a differently-named field that resolves against a different source,
    // not editing one string.
    expect(shapes).toEqual([
      { claimClass: 'FACT', evidenceField: 'entityEvidence' },
      { claimClass: 'OBSERVATION', evidenceField: 'metricEvidence' },
      { claimClass: 'INFERENCE', evidenceField: 'evidence' },
      { claimClass: 'RECOMMENDATION', evidenceField: 'evidence' },
      { claimClass: 'PRODUCT', evidenceField: 'productEvidence' },
    ])
  })
})

describe('parse semantics are unchanged by the union swap', () => {
  it.each([
    [{ claimClass: 'FACT', text: 'x', entityEvidence: ['1'] }],
    [{ claimClass: 'OBSERVATION', text: 'x', metricEvidence: ['m'] }],
    [{ claimClass: 'INFERENCE', text: 'ייתכן', evidence: ['1'] }],
    [{ claimClass: 'RECOMMENDATION', text: 'x', evidence: ['1'] }],
    [{ claimClass: 'PRODUCT', text: 'x', productEvidence: ['core_value'] }],
  ])('accepts a well-formed %o', (claim) => {
    expect(agentClaimSchema.safeParse(claim).success).toBe(true)
  })

  it.each([
    ['unknown claimClass', { claimClass: 'GUESS', text: 'x', evidence: ['1'] }],
    ['FACT with the wrong evidence field', { claimClass: 'FACT', text: 'x', evidence: ['1'] }],
    ['OBSERVATION with entity evidence', { claimClass: 'OBSERVATION', text: 'x', entityEvidence: ['1'] }],
    ['empty text', { claimClass: 'FACT', text: '', entityEvidence: ['1'] }],
    ['missing evidence', { claimClass: 'FACT', text: 'x' }],
  ])('rejects %s', (_label, claim) => {
    expect(agentClaimSchema.safeParse(claim).success).toBe(false)
  })

  it('accepts a whole answer and keeps unknown nullable but required', () => {
    const ok: AgentAnswer = {
      headline: 'ליד אחד ממתין.',
      claims: [{ claimClass: 'FACT', text: 'דוד ממתין.', entityEvidence: ['42'] }],
      unknown: null,
    }
    expect(agentAnswerSchema.safeParse(ok).success).toBe(true)
    expect(agentAnswerSchema.safeParse({ ...ok, unknown: 'לא ידוע' }).success).toBe(true)
    expect(agentAnswerSchema.safeParse({ headline: 'x', claims: [] }).success).toBe(false)
    expect(agentAnswerSchema.safeParse({ headline: '', claims: [], unknown: null }).success).toBe(false)
  })
})
