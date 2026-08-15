import { beforeEach, describe, expect, it, vi } from 'vitest'

const claimAnalysisJobs = vi.hoisted(() => vi.fn())
const completeAnalysisJob = vi.hoisted(() => vi.fn())
const getAnalysisConversationContext = vi.hoisted(() => vi.fn())
const getMaxMessageSequence = vi.hoisted(() => vi.fn())
const getIntelligenceCoverage = vi.hoisted(() => vi.fn())
const runConversationAnalyzer = vi.hoisted(() => vi.fn())
const notifyEvent = vi.hoisted(() => vi.fn())

vi.mock('@/db/conversationIntelligence', () => ({
  INTEL_KIND_ACTION: 'suggested_action',
  INTEL_KIND_INTENT: 'intent',
  INTEL_KIND_SUMMARY: 'summary',
  INTEL_KIND_TEMPERATURE: 'temperature',
  claimAnalysisJobs,
  completeAnalysisJob,
  conversationIntelligenceTag: () => 'tag',
  failAnalysisJob: vi.fn(),
  getAnalysisConversationContext,
  getIntelligenceCoverage,
  getMaxMessageSequence,
  insertIntelligenceRun: vi.fn(),
  listMessagesForAnalysis: vi.fn(async () => []),
  markAnalysisJobFailedTerminal: vi.fn(),
  markIntelligenceFailed: vi.fn(),
  reclaimStaleAnalysisJobs: vi.fn(async () => 0),
  refreshIntelligenceCoverage: vi.fn(),
  upsertManyConversationIntelligence: vi.fn(),
}))

vi.mock('@/lib/inbox/intelligence/conversationAnalyzer', () => ({
  ANALYZER_SCHEMA_VERSION: 1,
  ANALYZER_VERSION: 1,
  hashAnalysisInput: () => 'hash',
  promptVersion: 'p1',
  runConversationAnalyzer,
}))

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent,
}))

const { runConversationAnalysisWorker } = await import('@/lib/inbox/intelligence/worker')

beforeEach(() => {
  claimAnalysisJobs.mockReset()
  completeAnalysisJob.mockReset()
  getAnalysisConversationContext.mockReset()
  getMaxMessageSequence.mockReset()
  getIntelligenceCoverage.mockReset()
  runConversationAnalyzer.mockReset()
  notifyEvent.mockReset()
})

describe('conversation analysis worker — leadless gate', () => {
  it('skips AI and lead.hot when the conversation has no leadId', async () => {
    claimAnalysisJobs.mockResolvedValue([
      { id: 1, conversationId: 9, agencyId: 69, channel: 'whatsapp' },
    ])
    getMaxMessageSequence.mockResolvedValue(3)
    getIntelligenceCoverage.mockResolvedValue(null)
    getAnalysisConversationContext.mockResolvedValue({
      leadId: null,
      channel: 'whatsapp',
      customerName: 'Dana',
      leadName: null,
      leadStatus: null,
    })

    const result = await runConversationAnalysisWorker({ limit: 1 })

    expect(result.skipped).toBe(1)
    expect(runConversationAnalyzer).not.toHaveBeenCalled()
    expect(notifyEvent).not.toHaveBeenCalled()
    expect(completeAnalysisJob).toHaveBeenCalledWith(1)
  })
})
