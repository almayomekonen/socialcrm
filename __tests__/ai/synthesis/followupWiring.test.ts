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
vi.mock('@/lib/copilot/general/classifyGeneralIntent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/copilot/general/classifyGeneralIntent')>()
  return { ...actual, classifyGeneralIntent: vi.fn() }
})
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
vi.mock('@/lib/copilot/general/waitingInbound', () => ({ listWaitingWhatsappLeads: vi.fn() }))
vi.mock('@/lib/copilot/general/recentInbound', () => ({
  loadRecentInboundWhatsapp: vi.fn(),
  loadWaitingInboundWhatsapp: vi.fn(),
}))
vi.mock('@/lib/copilot/general/synthesis/synthesize', () => ({ synthesize: vi.fn() }))

import { askGeneralQuestion } from '@/actions/ai/askGeneralQuestion'
import { requireAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { track } from '@/lib/analytics/track'
import { isSynthesisEnabledForUser } from '@/lib/copilot/featureFlag'
import { synthesize } from '@/lib/copilot/general/synthesis/synthesize'
import { classifyGeneralIntent } from '@/lib/copilot/general/classifyGeneralIntent'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
} from '@/db/briefing'
import { getTodaysMeetings } from '@/db/meetings'
import { Roles } from '@/types/roles'
import { NOTHING_MORE } from '@/lib/copilot/general/continueConversation'

const convState = { surfacedRefIds: ['1'], executiveDecision: 'x', whys: ['y'] }
const emptyList = { total: 0, sample: [] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAgencyUser).mockResolvedValue({ id: 1, agencyId: 10, role: Roles.AGNT, name: 'דני' } as never)
  vi.mocked(getPerms).mockResolvedValue({ gotPermIds: [1] } as never)
  vi.mocked(track).mockResolvedValue(undefined)
  vi.mocked(getFollowUpsDueToday).mockResolvedValue(emptyList)
  vi.mocked(getLeadsNotContactedRecently).mockResolvedValue(emptyList)
  vi.mocked(getNewLeadsThisWeek).mockResolvedValue(emptyList)
  vi.mocked(getOverdueTaskSummary).mockResolvedValue(emptyList)
  vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 0, unread: 0 })
  vi.mocked(getTodaysMeetings).mockResolvedValue([])
  vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'unknown', confidence: 0 })
})

describe('askGeneralQuestion — follow-up continues CRM buckets (Phase 1)', () => {
  it('follow-up with state + material bucket → next unused data, synthesis unused', async () => {
    vi.mocked(isSynthesisEnabledForUser).mockReturnValue(true)
    vi.mocked(getOverdueTaskSummary).mockResolvedValue({ total: 2, sample: [{ id: 9, name: 'גיא', status: null }] })
    const res = await askGeneralQuestion('עוד משהו', undefined, undefined, convState)
    expect(res).toMatchObject({ kind: 'data', intent: 'tasks.overdue' })
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('follow-up with state + empty CRM → nothing more; synthesis unused', async () => {
    vi.mocked(isSynthesisEnabledForUser).mockReturnValue(true)
    const res = await askGeneralQuestion('עוד משהו', undefined, undefined, convState)
    expect(res).toEqual({ kind: 'guide', answer: NOTHING_MORE })
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('follow-up with flag OFF and empty CRM → nothing more', async () => {
    vi.mocked(isSynthesisEnabledForUser).mockReturnValue(false)
    const res = await askGeneralQuestion('עוד משהו', undefined, undefined, convState)
    expect(res).toEqual({ kind: 'guide', answer: NOTHING_MORE })
    expect(synthesize).not.toHaveBeenCalled()
  })
})
