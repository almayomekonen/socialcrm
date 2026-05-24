import { makeFieldCleaner } from './leadIntelligence'
import type { LeadAskAnswer } from './leadAskQuestionSchema'

export type AskQuestionSanitizationReport = {
  polluted: boolean
  fields: string[]
  sample?: string
}

const POLLUTION_PLACEHOLDER = 'אין מספיק מידע מובהק כדי לענות על השאלה.'

export function sanitizeLeadAskAnswer(out: LeadAskAnswer): {
  result: LeadAskAnswer
  report: AskQuestionSanitizationReport
} {
  const cleaner = makeFieldCleaner(POLLUTION_PLACEHOLDER)
  const answer = cleaner.clean(out.answer, 'answer')

  const report = cleaner.finalize()
  const dedupedSources = Array.from(new Set(out.sources)) as typeof out.sources

  return {
    result: {
      answer,
      confidence: report.polluted ? 'low' : out.confidence,
      sources: dedupedSources,
    },
    report,
  }
}
