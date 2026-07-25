import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/requireUser', () => { const __ru = vi.fn(); return { requireAgencyUser: __ru, requireProductAccess: __ru } })
vi.mock('@/db/filter', () => ({ getPerms: vi.fn() }))
vi.mock('@/db/meetings', () => ({ getTodaysMeetings: vi.fn() }))
vi.mock('@/db/briefing', () => ({
  getFollowUpsDueToday: vi.fn(),
  getLeadsNotContactedRecently: vi.fn(),
  getNewLeadsThisWeek: vi.fn(),
  getOverdueTaskSummary: vi.fn(),
  getUnreadInboxSummary: vi.fn(),
  getLeadsByName: vi.fn(),
  getNamedLeadById: vi.fn(),
}))
vi.mock('@/lib/copilot/general/classifyGeneralIntent', () => ({ classifyGeneralIntent: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
vi.mock('@/actions/ai/leadAskQuestion', () => ({ askLeadQuestion: vi.fn() }))
vi.mock('@/lib/copilot/general/reasonedAnswer', () => ({
  tryReasonedAnswer: vi.fn(),
  shouldReason: vi.fn(() => false),
}))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('@/lib/copilot/featureFlag', () => ({
  isReasonedGeneralEnabledForUser: vi.fn(() => false),
  isSynthesisEnabledForUser: vi.fn(),
}))
vi.mock('@/lib/copilot/general/facts/gatherFacts', () => ({ gatherTriageFacts: vi.fn() }))
vi.mock('@/lib/copilot/general/businessState', () => ({ classifyStates: vi.fn(() => []) }))
vi.mock('@/lib/copilot/general/synthesis/synthesize', () => ({ synthesize: vi.fn() }))

import { askGeneralQuestion } from '@/actions/ai/askGeneralQuestion'
import { requireAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { track } from '@/lib/analytics/track'
import { isSynthesisEnabledForUser } from '@/lib/copilot/featureFlag'
import { gatherTriageFacts } from '@/lib/copilot/general/facts/gatherFacts'
import { synthesize } from '@/lib/copilot/general/synthesis/synthesize'
import { Roles } from '@/types/roles'

const convState = { surfacedRefIds: ['1'], executiveDecision: 'x', whys: ['y'] }
const REASSURE = 'אלה הדברים שהכי חשובים כרגע — השאר יכול לחכות. אם יש משהו ספציפי שתרצה להעמיק בו, תגיד.'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAgencyUser).mockResolvedValue({ id: 1, agencyId: 10, role: Roles.AGNT, name: 'דני' } as never)
  vi.mocked(getPerms).mockResolvedValue({ gotPermIds: [1] } as never)
  vi.mocked(track).mockResolvedValue(undefined)
  vi.mocked(gatherTriageFacts).mockResolvedValue({} as never)
})

describe('askGeneralQuestion — Executive Synthesis on follow-up (C9)', () => {
  it('flag ON + Observation → surfaces it via the existing guide kind', async () => {
    vi.mocked(isSynthesisEnabledForUser).mockReturnValue(true)
    vi.mocked(synthesize).mockReturnValue({
      category: 'cluster',
      statement: '40 לידים מתקררים ללא מענה.',
      evidenceRefIds: ['1'],
      materiality: 1,
    })
    const res = await askGeneralQuestion('עוד משהו', undefined, undefined, convState)
    expect(res).toEqual({ kind: 'guide', answer: '40 לידים מתקררים ללא מענה.' })
  })

  it('flag ON + null → preserves the existing reassurance', async () => {
    vi.mocked(isSynthesisEnabledForUser).mockReturnValue(true)
    vi.mocked(synthesize).mockReturnValue(null)
    const res = await askGeneralQuestion('עוד משהו', undefined, undefined, convState)
    expect(res).toEqual({ kind: 'guide', answer: REASSURE })
  })

  it('flag OFF → byte-identical reassurance; synthesis pipeline never touched', async () => {
    vi.mocked(isSynthesisEnabledForUser).mockReturnValue(false)
    const res = await askGeneralQuestion('עוד משהו', undefined, undefined, convState)
    expect(res).toEqual({ kind: 'guide', answer: REASSURE })
    expect(gatherTriageFacts).not.toHaveBeenCalled()
    expect(synthesize).not.toHaveBeenCalled()
  })
})
