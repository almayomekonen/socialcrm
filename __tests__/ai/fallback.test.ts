import { describe, it, expect } from 'vitest'
import { classifyFallback, fallbackCopy, detectKnownGap, type FallbackResult } from '@/lib/copilot/general/fallback'

const BANNED = 'אין לי תשובה לשאלה הזו'
const gapOf = (q: string) => {
  const r = classifyFallback(q)
  return r.mode === 'redirect' ? r.gap : null
}

describe('classifyFallback — ACK (strict: every content token is an ack token)', () => {
  for (const q of ['תודה', 'תודה רבה', 'סבבה', 'מעולה', 'הבנתי', 'אוקיי', 'ok']) {
    it(`ack: "${q}"`, () => expect(classifyFallback(q).mode).toBe('ack'))
  }
  // NEGATIVES — a complaint or compound must NOT be ack (would be a silent dead-end)
  for (const q of ['תודה אבל זה לא עזר', 'תודה, מה הצעד הבא', 'מעולה אבל יש בעיה']) {
    it(`NOT ack: "${q}"`, () => expect(classifyFallback(q).mode).not.toBe('ack'))
  }
})

describe('classifyFallback — KNOWN GAPS (specific signals, measurable)', () => {
  it('כמה סגרתי החודש → results', () => expect(classifyFallback('כמה סגרתי החודש')).toEqual({ mode: 'redirect', gap: 'results' }))
  it('כמה כסף עשיתי → revenue', () => expect(classifyFallback('כמה כסף עשיתי')).toEqual({ mode: 'redirect', gap: 'revenue' }))
  it('כמה הכנסות היו לי → revenue', () =>
    expect(classifyFallback('כמה הכנסות היו לי')).toEqual({ mode: 'redirect', gap: 'revenue' }))
  it('מה ההכנסה שלי → revenue', () => expect(classifyFallback('מה ההכנסה שלי')).toEqual({ mode: 'redirect', gap: 'revenue' }))
  it('כמה כסף הפסדתי → revenue', () => expect(classifyFallback('כמה כסף הפסדתי')).toEqual({ mode: 'redirect', gap: 'revenue' }))
  it('מה אחוז הסגירה שלי → results', () =>
    expect(classifyFallback('מה אחוז הסגירה שלי')).toEqual({ mode: 'redirect', gap: 'results' }))

  it('growth questions are NOT a revenue gap', () => {
    expect(detectKnownGap('מה אני יכול לעשות כדי להרוויח כסף?')).toBeNull()
    expect(detectKnownGap('איך אני מגדיל מכירות?')).toBeNull()
    expect(detectKnownGap('איך אני מקדם את העסק?')).toBeNull()
    expect(detectKnownGap('במה להתמקד כדי לגדול?')).toBeNull()
    expect(detectKnownGap('איך אני מגדיל הכנסות?')).toBeNull()
    expect(classifyFallback('מה אני יכול לעשות כדי להרוויח כסף?')).toEqual({ mode: 'redirect', gap: null })
  })
  it('מאיזה מקור מגיעים הלידים → source', () =>
    expect(classifyFallback('מאיזה מקור מגיעים הלידים הכי טובים')).toEqual({ mode: 'redirect', gap: 'source' }))

  // FALSE-POSITIVE GUARDS — gap-adjacent words must NOT trigger a gap.
  it('כמה לידים יש לי → NOT a gap (bare כמה)', () => expect(gapOf('כמה לידים יש לי')).toBeNull())
  it('כמה זמן לוקח → NOT a gap', () => expect(gapOf('כמה זמן לוקח')).toBeNull())
  it('מה המקור של הליד → NOT source gap (lead-specific phrasing)', () =>
    expect(gapOf('מה המקור של הליד')).toBeNull())
})

describe('classifyFallback — CLARIFY (bare interrogatives only)', () => {
  for (const q of ['למה?', 'איך?', 'מה?', 'מה זאת אומרת', 'כלומר']) {
    it(`clarify: "${q}"`, () => expect(classifyFallback(q).mode).toBe('clarify'))
  }
  it('substantive question is NOT clarify → redirect', () =>
    expect(classifyFallback('למה אני לא סוגר עסקאות').mode).toBe('redirect'))
})

describe('classifyFallback — default + trust property', () => {
  it('unrecognized → generic redirect', () => expect(classifyFallback('בלה בלה משהו')).toEqual({ mode: 'redirect', gap: null }))
  it('empty → redirect', () => expect(classifyFallback('   ')).toEqual({ mode: 'redirect', gap: null }))
  // Business-wide questions are NEVER ack/clarify (they are redirect, often a tagged gap).
  for (const q of ['כמה סגרתי', 'מאיזה מקור הכי טוב', 'כמה כסף עשיתי']) {
    it(`business-wide "${q}" → redirect, never ack/clarify`, () => expect(classifyFallback(q).mode).toBe('redirect'))
  }
})

describe('detectKnownGap — single source of truth', () => {
  it('results', () => expect(detectKnownGap('כמה סגרתי החודש?')).toBe('results'))
  it('revenue', () => expect(detectKnownGap('כמה כסף עשיתי?')).toBe('revenue'))
  it('source', () => expect(detectKnownGap('מאיזה מקור מגיעים הלידים הכי טובים?')).toBe('source'))
  it('no gap', () => expect(detectKnownGap('כמה לידים יש לי')).toBeNull())
  it('classifyFallback delegates to detectKnownGap', () =>
    expect(classifyFallback('כמה סגרתי')).toEqual({ mode: 'redirect', gap: detectKnownGap('כמה סגרתי') }))
})

describe('fallbackCopy — honest, dead-end-free (banned phrase never appears)', () => {
  const all: FallbackResult[] = [
    { mode: 'ack' },
    { mode: 'clarify' },
    { mode: 'redirect', gap: null },
    { mode: 'redirect', gap: 'results' },
    { mode: 'redirect', gap: 'revenue' },
    { mode: 'redirect', gap: 'source' },
  ]
  for (const r of all) {
    const label = r.mode === 'redirect' ? `redirect/${r.gap ?? 'generic'}` : r.mode
    it(`"${label}" → non-empty and not the banned phrase`, () => {
      const copy = fallbackCopy(r)
      expect(copy.length).toBeGreaterThan(0)
      expect(copy).not.toContain(BANNED)
    })
  }
  it('known-gap copy names the specific limit (honest, not generic)', () => {
    expect(fallbackCopy({ mode: 'redirect', gap: 'results' })).toContain('סגירות')
    expect(fallbackCopy({ mode: 'redirect', gap: 'revenue' })).toContain('הכנסה')
    expect(fallbackCopy({ mode: 'redirect', gap: 'source' })).toContain('מקור')
  })
})
