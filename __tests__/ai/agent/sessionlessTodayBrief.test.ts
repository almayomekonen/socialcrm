/**
 * `get_today_state`'s seam.
 *
 * The tool always passed `viewer.agencyId` to `buildTodayBrief` — and
 * `buildTodayBrief` then handed the two lead readers a scope WITHOUT it, so both
 * re-derived the agency from the session. The agency was present the whole time
 * and simply not threaded. This pins the threading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Roles } from '@/types/roles'

const { getBriefCandidateFacts, getTouchedTodayIds } = vi.hoisted(() => ({
  getBriefCandidateFacts: vi.fn(async () => []),
  getTouchedTodayIds: vi.fn(async () => [] as number[]),
}))

vi.mock('@/db/today/facts', () => ({ getBriefCandidateFacts }))
vi.mock('@/db/today/handled', () => ({ getTouchedTodayIds }))
vi.mock('@/db/today/freshness', () => ({ getInboundSyncFreshness: vi.fn(async () => ({ dataFresh: true })) }))
vi.mock('@/db/meetings', () => ({ getTodaysMeetings: vi.fn(async () => []) }))
vi.mock('@/db/inboxWaiting', () => ({ listOldestWaitingWhatsappByLeadIds: vi.fn(async () => []) }))

import { buildTodayBrief } from '@/lib/today/service'

const VIEWER = {
  scope: { user: { role: Roles.ADMIN }, gotPermIds: [] },
  agencyId: 103,
  userId: 332,
  firstName: 'עלמה',
}

beforeEach(() => {
  getBriefCandidateFacts.mockClear()
  getTouchedTodayIds.mockClear()
})

describe('buildTodayBrief threads the viewer agency into both lead readers', () => {
  it('getBriefCandidateFacts receives the agency', async () => {
    await buildTodayBrief(VIEWER, Date.parse('2026-08-26T09:00:00Z'))
    expect(getBriefCandidateFacts).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 103 }))
  })

  it('getTouchedTodayIds receives the agency', async () => {
    await buildTodayBrief(VIEWER, Date.parse('2026-08-26T09:00:00Z'))
    expect(getTouchedTodayIds).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 103 }), expect.any(Number))
  })

  it('the permission set is passed through unchanged alongside it', async () => {
    await buildTodayBrief({ ...VIEWER, scope: { user: { role: Roles.AGNT }, gotPermIds: [7, 8] } }, Date.now())
    expect(getBriefCandidateFacts).toHaveBeenCalledWith({
      user: { role: Roles.AGNT },
      gotPermIds: [7, 8],
      agencyId: 103,
    })
  })
})
