/**
 * The CI half of the WhatsApp assistant eval: no model, no database, no cost.
 * It guards the set itself, so the baseline and every later run keep measuring
 * the same thing (results/ holds the recorded runs).
 */
import { describe, expect, it } from 'vitest'
import { CASES, DOCUMENTED_FAILURES } from './cases'

describe('the WhatsApp assistant regression set', () => {
  it('has unique ids, and every documented failure is in it', () => {
    const ids = CASES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of Object.values(DOCUMENTED_FAILURES)) expect(ids).toContain(id)
  })

  it('names the production investigation every real case came from', () => {
    for (const c of CASES.filter((x) => x.origin === 'real')) expect(c.prodId, c.id).toBeGreaterThan(0)
  })

  it('holds the cases the P0 brief requires', () => {
    const qs = CASES.map((c) => c.question)
    for (const q of ['אלוף', 'מה חדש במערכת?', 'כמה העסק שלי עשה השנה?', 'תודה', 'מה נשמע?', 'סלמתאק', 'hey'])
      expect(qs).toContain(q)
    expect(CASES.some((c) => c.question === 'סלמתאק' && (c.history?.length ?? 0) > 0)).toBe(true)
  })

  it('every social message must be answered with no tools and as a plain reply', () => {
    for (const c of CASES.filter((x) => x.kind === 'social')) {
      expect(c.maxTools, c.id).toBe(0)
      expect(c.plain, c.id).toBe(true)
    }
  })

  it('a multi-turn case alternates user and assistant, starting with the user', () => {
    for (const c of CASES.filter((x) => x.history)) {
      c.history!.forEach((t, i) => expect(t.role, `${c.id}[${i}]`).toBe(i % 2 === 0 ? 'user' : 'assistant'))
    }
  })
})
