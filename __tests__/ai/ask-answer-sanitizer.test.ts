import { describe, it, expect } from 'vitest'
import { LeadAskAnswerSchema, sanitizeLeadAskAnswer, type LeadAskAnswer } from '@/lib/ai/prompts/leadAskQuestion'

// ─── sanitizeLeadAskAnswer ──────────────────────────────────────────────────
// Mirrors the policy of sanitizeLeadSummary (already covered) but for the
// freeform Q&A action. Pollution in `answer` substitutes the placeholder and
// drops confidence to 'low'. Sources are deduped. Non-source structure is
// untouched on clean input.

const PLACEHOLDER = 'אין מספיק מידע מובהק כדי לענות על השאלה.'

const cleanAnswer: LeadAskAnswer = {
  answer: 'תיאום שיחה לחידוש קשר השבוע.',
  confidence: 'medium',
  sources: ['פעילות אחרונה', 'היסטוריית המשימות'],
}

describe('sanitizeLeadAskAnswer — clean output passes through', () => {
  it('preserves answer, confidence, and sources verbatim', () => {
    const { result, report } = sanitizeLeadAskAnswer(cleanAnswer)
    expect(report.polluted).toBe(false)
    expect(report.fields).toEqual([])
    expect(result).toEqual(cleanAnswer)
  })
})

describe('sanitizeLeadAskAnswer — pollution detection', () => {
  it.each([
    ['daysSinceLastInteraction'],
    ['pipelineStagnation'],
    ['hasHandler'],
    ['recentTasks'],
    ['stale'],
    ['cold'],
  ])('flags banned token "%s" in answer and substitutes placeholder', (token) => {
    const polluted: LeadAskAnswer = { ...cleanAnswer, answer: `התשובה: ${token}=null וכו'.`, confidence: 'high' }
    const { result, report } = sanitizeLeadAskAnswer(polluted)
    expect(report.polluted).toBe(true)
    expect(report.fields).toContain('answer')
    expect(result.answer).toBe(PLACEHOLDER)
    expect(result.confidence).toBe('low')
  })

  it('reports a sample of which token tripped detection', () => {
    const polluted: LeadAskAnswer = { ...cleanAnswer, answer: 'inactivityRisk=high.' }
    const { report } = sanitizeLeadAskAnswer(polluted)
    expect(report.polluted).toBe(true)
    expect(typeof report.sample).toBe('string')
    expect(report.sample!.length).toBeGreaterThan(0)
  })

  it('demotes confidence to low when polluted (regardless of model claim)', () => {
    const polluted: LeadAskAnswer = { ...cleanAnswer, answer: 'pipelineStagnation=cold.', confidence: 'high' }
    const { result } = sanitizeLeadAskAnswer(polluted)
    expect(result.confidence).toBe('low')
  })
})

describe('sanitizeLeadAskAnswer — sources dedup + preserve order', () => {
  it('dedupes duplicate categories', () => {
    const dup: LeadAskAnswer = {
      ...cleanAnswer,
      sources: ['היסטוריית המשימות', 'היסטוריית המשימות', 'סטטוס הליד'],
    }
    const { result } = sanitizeLeadAskAnswer(dup)
    expect(result.sources).toEqual(['היסטוריית המשימות', 'סטטוס הליד'])
  })

  it('preserves source order while deduping', () => {
    const dup: LeadAskAnswer = {
      ...cleanAnswer,
      sources: ['קבצים שצורפו', 'פעילות אחרונה', 'קבצים שצורפו'],
    }
    const { result } = sanitizeLeadAskAnswer(dup)
    expect(result.sources).toEqual(['קבצים שצורפו', 'פעילות אחרונה'])
  })
})

// ─── Schema invariants ──────────────────────────────────────────────────────
// The ask-question schema accepts the file-attribution source; the legacy
// summary/next-step schemas do not. This pin protects the file attribution
// channel from accidental removal.

describe('LeadAskAnswerSchema', () => {
  it('accepts "קבצים שצורפו" as a source category', () => {
    const parsed = LeadAskAnswerSchema.safeParse({
      answer: 'התשובה מסתמכת על הקובץ המצורף.',
      confidence: 'high',
      sources: ['קבצים שצורפו'],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an answer shorter than the minimum', () => {
    const parsed = LeadAskAnswerSchema.safeParse({
      answer: 'קצר',
      confidence: 'medium',
      sources: ['סטטוס הליד'],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects more than 3 sources', () => {
    const parsed = LeadAskAnswerSchema.safeParse({
      answer: 'תשובה תקינה.',
      confidence: 'medium',
      sources: ['סטטוס הליד', 'פעילות אחרונה', 'היסטוריית המשימות', 'מקור הליד'],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown source category', () => {
    const parsed = LeadAskAnswerSchema.safeParse({
      answer: 'תשובה תקינה.',
      confidence: 'medium',
      sources: ['קטגוריה-לא-קיימת'],
    })
    expect(parsed.success).toBe(false)
  })
})
