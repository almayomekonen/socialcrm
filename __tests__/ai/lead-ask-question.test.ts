import { describe, expect, it } from 'vitest'
import {
  LeadAskAnswerSchema,
  buildLeadAskQuestionUserMessage,
  type LeadQuestionAttachmentContext,
} from '@/lib/ai/prompts/leadAskQuestion'
import type { LeadIntelligenceInputs } from '@/db/aiSummaries'

const baseInputs: LeadIntelligenceInputs = {
  status: 'בטיפול',
  leadSource: 'instagram',
  rank: null,
  hasHandler: false,
  handlerName: null,
  gender: null,
  familyStatus: null,
  ageYears: null,
  hasEmail: false,
  hasPhone: true,
  familyMemberCount: 0,
  detailsExcerpt: null,
  leadAgeDays: 4,
  daysSinceLastInteraction: null,
  daysInCurrentStatus: 4,
  lastOutcomeType: null,
  daysSinceLastTask: null,
  daysSinceLastCompletedTask: null,
  taskCompletionRate: null,
  overdueTaskCount: 0,
  pipelineStagnation: 'active',
  inactivityRisk: 'low',
  recentTasks: [],
  updatedAtIso: null,
}

function parseAttachmentShape(message: string): Array<Record<string, unknown>> {
  // Anchor on the JSON array brackets directly. With `JSON.stringify(_, null, 2)`
  // the closing `]` always appears on its own line, so `\n]` is a stable
  // terminator regardless of where the lead-JSON block sits relative to the
  // attachments block (the user-message ordering is reorder-aware).
  const m = message.match(/קבצים מצורפים לשאלה \(JSON\):\n(\[[\s\S]*?\n\])/)
  if (!m) throw new Error('Could not parse attachment JSON block')
  return JSON.parse(m[1])
}

describe('lead ask question prompt — file attachments', () => {
  it('adds readable file content with Hebrew-only operational keys', () => {
    const attachments: LeadQuestionAttachmentContext[] = [
      {
        kind: 'text',
        name: 'contract.pdf',
        mediaType: 'application/pdf',
        size: 1200,
        content: 'תנאי תשלום: 30 יום ממועד חתימה.',
        partial: false,
        originalChars: 31,
      },
    ]

    const msg = buildLeadAskQuestionUserMessage({
      inputs: baseInputs,
      leadName: 'דני',
      question: 'מה תנאי התשלום?',
      lenses: ['files'],
      attachments,
    })

    const shape = parseAttachmentShape(msg)
    expect(shape[0]).toMatchObject({
      'שם הקובץ': 'contract.pdf',
      'סוג': 'PDF',
      'מצב קריאה': 'מלא',
      'תוכן שנקרא': 'תנאי תשלום: 30 יום ממועד חתימה.',
    })
    expect(msg).not.toContain('fileId')
    expect(msg).not.toContain('mediaType')
    expect(msg).not.toContain('truncated')
    expect(msg).not.toContain('originalChars')
  })

  it('marks partial content quietly in the attachment block', () => {
    const msg = buildLeadAskQuestionUserMessage({
      inputs: baseInputs,
      leadName: null,
      question: 'סכם את הקובץ',
      lenses: ['files'],
      attachments: [
        {
          kind: 'text',
          name: 'leads.xlsx',
          mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 2000,
          content: 'name,phone\nDana,050',
          partial: true,
          originalChars: 80_000,
        },
      ],
    })

    expect(parseAttachmentShape(msg)[0]['מצב קריאה']).toBe('חלקי')
  })

  it('allows file attribution for ask-question answers only', () => {
    const parsed = LeadAskAnswerSchema.safeParse({
      answer: 'תנאי התשלום שמופיעים בקובץ הם 30 יום ממועד חתימה.',
      confidence: 'high',
      sources: ['קבצים שצורפו'],
    })

    expect(parsed.success).toBe(true)
  })
})
