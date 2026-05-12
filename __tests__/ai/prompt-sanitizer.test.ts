import { describe, it, expect } from 'vitest'
import { sanitizeLeadSummary, buildLeadIntelUserMessage, type LeadSummary } from '@/lib/ai/prompts/leadIntelligence'
import type { LeadIntelligenceInputs } from '@/db/aiSummaries'

const cleanSummary: LeadSummary = {
  summary: 'ליד פעיל, שלושה ימים בסטטוס פתוח. הקשר עוד לא הותנע.',
  keyInsights: ['אין משימה פתוחה למעקב.'],
  suggestedNextAction: {
    title: 'תיאום שיחת מעקב ראשונה',
    reason: 'אין תיעוד קשר אחרי הפנייה הראשונית.',
  },
  sources: ['סטטוס הליד', 'היסטוריית המשימות'],
  confidence: 'medium',
}

const PLACEHOLDER = 'אין מספיק מידע מובהק להסקה.'

// ─── sanitizeLeadSummary ─────────────────────────────────────────────────────

describe('sanitizeLeadSummary — clean output passes through unchanged', () => {
  it('clean output is unchanged in shape and content', () => {
    const { result, report } = sanitizeLeadSummary(cleanSummary)
    expect(report.polluted).toBe(false)
    expect(report.fields).toEqual([])
    expect(result.summary).toBe(cleanSummary.summary)
    expect(result.keyInsights).toEqual(cleanSummary.keyInsights)
    expect(result.suggestedNextAction).toEqual(cleanSummary.suggestedNextAction)
    expect(result.confidence).toBe('medium')
  })

  it('empty insights array survives sanitization', () => {
    const empty: LeadSummary = { ...cleanSummary, keyInsights: [] }
    const { result, report } = sanitizeLeadSummary(empty)
    expect(report.polluted).toBe(false)
    expect(result.keyInsights).toEqual([])
  })
})

describe('sanitizeLeadSummary — leakage detection', () => {
  it('detects English field names in summary and drops confidence to low', () => {
    const polluted: LeadSummary = {
      ...cleanSummary,
      summary: 'הליד מאותת לעניין, daysSinceLastInteraction=null.',
      confidence: 'high',
    }
    const { result, report } = sanitizeLeadSummary(polluted)
    expect(report.polluted).toBe(true)
    expect(report.fields).toContain('summary')
    expect(result.summary).toBe(PLACEHOLDER)
    expect(result.confidence).toBe('low')
  })

  it.each([['pipelineStagnation'], ['hasHandler'], ['recentTasks'], ['overdueTaskCount'], ['inactivityRisk']])(
    'flags banned token "%s" embedded in summary',
    (token) => {
      const polluted: LeadSummary = {
        ...cleanSummary,
        summary: `המידע: ${token}=stale וכו'.`,
      }
      const { report } = sanitizeLeadSummary(polluted)
      expect(report.polluted).toBe(true)
      expect(report.fields).toContain('summary')
    },
  )

  it('detects pollution in keyInsights and removes only the polluted item', () => {
    const polluted: LeadSummary = {
      ...cleanSummary,
      keyInsights: ['תובנה נקייה', 'יש מספר טלפון. hasHandler=true.'],
    }
    const { result, report } = sanitizeLeadSummary(polluted)
    expect(report.polluted).toBe(true)
    expect(report.fields).toContain('keyInsights[1]')
    // Polluted insight is removed (filtered out), clean one survives.
    expect(result.keyInsights).toEqual(['תובנה נקייה'])
    expect(result.confidence).toBe('low')
  })

  it('detects pollution in suggestedNextAction.title', () => {
    const polluted: LeadSummary = {
      ...cleanSummary,
      suggestedNextAction: {
        title: 'cold lead — call now',
        reason: 'נקי',
      },
    }
    const { result, report } = sanitizeLeadSummary(polluted)
    expect(report.polluted).toBe(true)
    expect(report.fields).toContain('suggestedNextAction.title')
    expect(result.suggestedNextAction.title).toBe(PLACEHOLDER)
    expect(result.suggestedNextAction.reason).toBe('נקי')
    expect(result.confidence).toBe('low')
  })

  it('detects pollution in suggestedNextAction.reason', () => {
    const polluted: LeadSummary = {
      ...cleanSummary,
      suggestedNextAction: {
        title: 'נקי',
        reason: 'להמשיך את התקדמות הליד בפייפליין. inactivityRisk=medium.',
      },
    }
    const { result, report } = sanitizeLeadSummary(polluted)
    expect(report.polluted).toBe(true)
    expect(report.fields).toContain('suggestedNextAction.reason')
    expect(result.suggestedNextAction.reason).toBe(PLACEHOLDER)
    expect(result.confidence).toBe('low')
  })

  it('detects null/undefined/=true/=false leakage tokens', () => {
    const polluted: LeadSummary = {
      ...cleanSummary,
      summary: 'הסטטוס הוא null ו-active=true.',
    }
    const { report } = sanitizeLeadSummary(polluted)
    expect(report.polluted).toBe(true)
  })

  it('reports a sample of which token tripped the detector', () => {
    const polluted: LeadSummary = {
      ...cleanSummary,
      summary: 'pipelineStagnation=stale.',
    }
    const { report } = sanitizeLeadSummary(polluted)
    expect(report.polluted).toBe(true)
    expect(typeof report.sample).toBe('string')
    expect(report.sample!.length).toBeGreaterThan(0)
  })
})

describe('sanitizeLeadSummary — sources dedup', () => {
  it('dedupes duplicate source categories', () => {
    const dup: LeadSummary = {
      ...cleanSummary,
      sources: ['היסטוריית המשימות', 'היסטוריית המשימות', 'סטטוס הליד'],
    }
    const { result } = sanitizeLeadSummary(dup)
    expect(result.sources).toEqual(['היסטוריית המשימות', 'סטטוס הליד'])
  })

  it('preserves source order while deduping', () => {
    const dup: LeadSummary = {
      ...cleanSummary,
      sources: ['סטטוס הליד', 'פעילות אחרונה', 'סטטוס הליד'],
    }
    const { result } = sanitizeLeadSummary(dup)
    expect(result.sources).toEqual(['סטטוס הליד', 'פעילות אחרונה'])
  })
})

describe('sanitizeLeadSummary — multiple-field pollution', () => {
  it('reports every polluted field, not just the first', () => {
    const polluted: LeadSummary = {
      ...cleanSummary,
      summary: 'pipelineStagnation=stale',
      keyInsights: ['recentTasks=[]'],
      suggestedNextAction: { title: 'cold call', reason: 'hasHandler=false' },
    }
    const { report } = sanitizeLeadSummary(polluted)
    expect(report.polluted).toBe(true)
    expect(report.fields).toContain('summary')
    expect(report.fields).toContain('keyInsights[0]')
    expect(report.fields).toContain('suggestedNextAction.title')
    expect(report.fields).toContain('suggestedNextAction.reason')
  })
})

// ─── buildLeadIntelUserMessage (proxy for pruneAndTranslate) ────────────────

const baseInputs: LeadIntelligenceInputs = {
  status: 'בטיפול',
  leadSource: 'instagram',
  rank: 3,
  hasHandler: true,
  handlerName: 'דנה',
  gender: null,
  familyStatus: null,
  ageYears: null,
  hasEmail: false,
  hasPhone: true,
  familyMemberCount: 0,
  detailsExcerpt: null,
  leadAgeDays: 12,
  daysSinceLastInteraction: 5,
  daysInCurrentStatus: 4,
  lastOutcomeType: null,
  daysSinceLastTask: 2,
  daysSinceLastCompletedTask: 8,
  taskCompletionRate: 0.6,
  overdueTaskCount: 0,
  pipelineStagnation: 'active',
  inactivityRisk: 'low',
  recentTasks: [],
  updatedAtIso: '2025-05-01T12:00:00.000Z',
}

function parsePromptShape(message: string): Record<string, unknown> {
  // buildLeadIntelUserMessage formats as:
  //   "נתוני הליד (JSON):\n<json>\n\nהחזר אובייקט לפי הסכמה."
  const m = message.match(/^נתוני הליד \(JSON\):\n([\s\S]*?)\n\nהחזר/)
  if (!m) throw new Error('Could not parse prompt shape from user message')
  return JSON.parse(m[1])
}

describe('buildLeadIntelUserMessage — translates internal keys to Hebrew', () => {
  it('uses operational Hebrew keys, never English field names', () => {
    const msg = buildLeadIntelUserMessage(baseInputs)
    const shape = parsePromptShape(msg)
    expect(shape).toHaveProperty('סטטוס')
    expect(shape).toHaveProperty('מקור הליד')
    expect(shape).toHaveProperty('ימים מהיצירה')
    expect(shape).toHaveProperty('ימים בסטטוס נוכחי')
    expect(shape).toHaveProperty('ימים מאינטראקציה אחרונה')
    expect(shape).toHaveProperty('דירוג')
    expect(shape).toHaveProperty('מטפל בליד')
    // Critically: NO English field names in the prompt shape.
    expect(shape).not.toHaveProperty('status')
    expect(shape).not.toHaveProperty('leadSource')
    expect(shape).not.toHaveProperty('hasHandler')
    expect(shape).not.toHaveProperty('handlerName')
    expect(shape).not.toHaveProperty('daysSinceLastInteraction')
    expect(shape).not.toHaveProperty('pipelineStagnation')
  })

  it('translates pipelineStagnation enum to operational Hebrew label', () => {
    const msg = buildLeadIntelUserMessage({ ...baseInputs, pipelineStagnation: 'stale' })
    const shape = parsePromptShape(msg)
    expect(shape['מצב הטיפול']).toBe('דועך')
    // English enum value must NOT appear anywhere in the message.
    expect(msg).not.toContain('"stale"')
    expect(msg).not.toContain('pipelineStagnation')
  })

  it('translates inactivityRisk enum and uses softened label', () => {
    const msg = buildLeadIntelUserMessage({ ...baseInputs, inactivityRisk: 'high' })
    const shape = parsePromptShape(msg)
    expect(shape['דחיפות במעקב']).toBe('גבוה')
    // The corporate-leaning original label "סיכון נטישה" was renamed in v4.
    expect(shape).not.toHaveProperty('סיכון נטישה')
    expect(msg).not.toContain('inactivityRisk')
  })
})

describe('buildLeadIntelUserMessage — pruneAndTranslate drops empty fields', () => {
  it('drops null fields, zero counts, and false booleans', () => {
    const sparse: LeadIntelligenceInputs = {
      ...baseInputs,
      gender: null,
      familyStatus: null,
      ageYears: null,
      hasEmail: false,
      hasPhone: false,
      familyMemberCount: 0,
      detailsExcerpt: null,
      lastOutcomeType: null,
      overdueTaskCount: 0,
      hasHandler: false,
      handlerName: null,
      recentTasks: [],
    }
    const shape = parsePromptShape(buildLeadIntelUserMessage(sparse))

    // Demographics: dropped when null, never reported as missing.
    expect(shape).not.toHaveProperty('מין')
    expect(shape).not.toHaveProperty('מצב משפחתי')
    expect(shape).not.toHaveProperty('גיל')
    expect(shape).not.toHaveProperty('מספר בני משפחה')

    // Boolean false: never surfaced.
    expect(shape).not.toHaveProperty('ערוץ קשר: מייל')
    expect(shape).not.toHaveProperty('ערוץ קשר: טלפון')

    // Zero count: dropped.
    expect(shape).not.toHaveProperty('משימות באיחור')

    // Free text empty: dropped.
    expect(shape).not.toHaveProperty('הערות מילוליות')

    // No handler: ownership block dropped.
    expect(shape).not.toHaveProperty('מטפל בליד')

    // Empty task list: dropped.
    expect(shape).not.toHaveProperty('משימות אחרונות')

    // Sanity: present anchors still appear.
    expect(shape).toHaveProperty('סטטוס')
    expect(shape).toHaveProperty('מקור הליד')
  })

  it('keeps boolean true contact channels (soft anchors)', () => {
    const shape = parsePromptShape(buildLeadIntelUserMessage({ ...baseInputs, hasEmail: true, hasPhone: true }))
    expect(shape['ערוץ קשר: מייל']).toBe(true)
    expect(shape['ערוץ קשר: טלפון']).toBe(true)
  })

  it('keeps non-zero overdue count', () => {
    const shape = parsePromptShape(buildLeadIntelUserMessage({ ...baseInputs, overdueTaskCount: 3 }))
    expect(shape['משימות באיחור']).toBe(3)
  })

  it('emits recentTasks with operational Hebrew keys when non-empty', () => {
    const shape = parsePromptShape(
      buildLeadIntelUserMessage({
        ...baseInputs,
        recentTasks: [{ title: 'שיחה ראשונה', status: 'הושלם', daysOld: 3 }],
      }),
    )
    expect(Array.isArray(shape['משימות אחרונות'])).toBe(true)
    const tasks = shape['משימות אחרונות'] as Array<Record<string, unknown>>
    expect(tasks[0]).toEqual({ כותרת: 'שיחה ראשונה', סטטוס: 'הושלם', ימים: 3 })
  })

  it('handles details excerpt only when non-empty', () => {
    const present = parsePromptShape(buildLeadIntelUserMessage({ ...baseInputs, detailsExcerpt: 'שיחה ראשונה הסתיימה היטב' }))
    expect(present['הערות מילוליות']).toBe('שיחה ראשונה הסתיימה היטב')

    const empty = parsePromptShape(buildLeadIntelUserMessage({ ...baseInputs, detailsExcerpt: '   ' }))
    expect(empty).not.toHaveProperty('הערות מילוליות')
  })
})

describe('buildLeadIntelUserMessage — no banned tokens leak into the prompt', () => {
  it('a fully-populated input never echoes raw English keys back into the message', () => {
    const msg = buildLeadIntelUserMessage({
      ...baseInputs,
      pipelineStagnation: 'cold',
      inactivityRisk: 'high',
      overdueTaskCount: 2,
      detailsExcerpt: 'הערה',
      recentTasks: [{ title: 't', status: 'open', daysOld: 1 }],
    })
    // The prompt shape uses Hebrew-only keys. None of these internal field
    // identifiers should ever appear in the JSON the model sees.
    for (const banned of [
      'pipelineStagnation',
      'inactivityRisk',
      'daysSinceLastInteraction',
      'daysInCurrentStatus',
      'overdueTaskCount',
      'taskCompletionRate',
      'hasHandler',
      'hasEmail',
      'hasPhone',
      'recentTasks',
      'detailsExcerpt',
      'familyMemberCount',
      'leadAgeDays',
    ]) {
      expect(msg).not.toContain(banned)
    }
  })
})
