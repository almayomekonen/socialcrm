import { describe, it, expect } from 'vitest'
import { inferObjective, DEFAULT_OBJECTIVE, type Objective } from '@/lib/copilot/general/objective'

const OBJECTIVES: Objective[] = ['action', 'understand', 'summarize', 'create']

describe('inferObjective', () => {
  it('returns a business goal from the closed vocabulary', () => {
    expect(OBJECTIVES).toContain(inferObjective({ text: 'מה לעשות היום?' }).objective)
  })

  it('distinguishes the four business goals (not just one default)', () => {
    expect(inferObjective({ text: 'מה דחוף עכשיו?' }).objective).toBe('action')
    expect(inferObjective({ text: 'תן לי סיכום' }).objective).toBe('summarize')
    expect(inferObjective({ text: 'למה זה קורה?' }).objective).toBe('understand')
    expect(inferObjective({ text: 'נסח הודעה לדנה' }).objective).toBe('create')
    expect(inferObjective({ text: 'על מי כדאי לעבוד?' }).objective).toBe('discover')
    expect(inferObjective({ text: 'מי מחכה לי?' }).objective).toBe('waiting')
    expect(inferObjective({ text: 'איפה אני מפספס?' }).objective).toBe('gaps')
    expect(inferObjective({ text: 'מה חדש במערכת?' }).objective).toBe('summarize')
  })

  it('never dead-ends: unclear input falls back to the default objective', () => {
    const r = inferObjective({ text: 'אהקסjkl?!' })
    expect(r.objective).toBe(DEFAULT_OBJECTIVE)
    expect(/default|falling back/i.test(r.reasoning)).toBe(true)
  })

  it('does not manufacture confidence — the field is omitted', () => {
    const r = inferObjective({ text: 'מה כדאי לי?' })
    expect(Object.keys(r).sort()).toEqual(['objective', 'reasoning'])
    expect(r.confidence).toBeUndefined()
  })

  it('reasoning explains the decision (and the fallback names a default)', () => {
    expect(inferObjective({ text: 'תן לי סיכום' }).reasoning).toMatch(/summari/i)
    expect(inferObjective({ text: '...' }).reasoning).toMatch(/default|falling back/i)
  })

  it('keys on goal language, not data sources', () => {
    // A bare data-source noun with no intent verb does NOT route — it defaults.
    const bare = inferObjective({ text: 'משימות' })
    expect(bare.objective).toBe(DEFAULT_OBJECTIVE)
    expect(/default|falling back/i.test(bare.reasoning)).toBe(true)
    // Same intent verb, different data source → same goal, detected (not defaulted).
    const a = inferObjective({ text: 'מה לעשות עם המשימות' })
    const b = inferObjective({ text: 'מה לעשות עם הלידים' })
    expect(a.objective).toBe('action')
    expect(b.objective).toBe('action')
    expect(/default/i.test(a.reasoning)).toBe(false)
  })

  it('treats empty/whitespace as no signal → default, not an error', () => {
    expect(inferObjective({ text: '   ' }).objective).toBe(DEFAULT_OBJECTIVE)
  })

  it('is pure and synchronous: same input → identical output', () => {
    expect(inferObjective({ text: 'מה לעשות?' })).toEqual(inferObjective({ text: 'מה לעשות?' }))
  })
})
