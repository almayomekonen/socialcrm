/**
 * WhatsApp Agent — the presence writes themselves.
 *
 * Two properties that cannot be inferred from behaviour tests, asserted against
 * the SQL because this repo has no live Postgres in the test harness:
 *
 *   1. A typing heartbeat NEVER touches `aiState`. If it ever did, one keystroke
 *      would permanently silence the agent on that conversation — the exact
 *      failure the transient model exists to avoid.
 *   2. Both writes are agency-scoped in the statement itself, not by a caller
 *      remembering to check first.
 *
 * Plus the server action's contract, which is the only way the browser can move
 * presence at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const raw = vi.hoisted(() =>
  vi.fn(async (_sql: string, _binds?: Record<string, unknown>) => ({ rows: [{ conversationId: 382 }] })),
)
const requireAgencyUser = vi.hoisted(() => vi.fn())
const recordHumanTypingSpy = vi.hoisted(() => vi.fn())

vi.mock('@/config/db', () => ({
  db: Object.assign(() => ({ where: () => ({ first: async () => null }) }), {
    raw,
    fn: { now: () => new Date() },
  }),
}))

import { markHumanActiveByConversation, recordHumanTyping } from '@/db/conversationHumanPresence'
import { HUMAN_TYPING_TTL_MS } from '@/lib/inbox/autoresponse/humanPresence'

const lastCall = () => raw.mock.calls[raw.mock.calls.length - 1]
const lastSql = (): string => String(lastCall()?.[0] ?? '')
const lastBinds = (): Record<string, unknown> => (lastCall()?.[1] ?? {}) as Record<string, unknown>

beforeEach(() => {
  raw.mockClear()
})

describe('the typing heartbeat', () => {
  it('never writes aiState — typing is presence, not takeover', () => {
    void recordHumanTyping({ conversationId: 382, agencyId: 103, userId: 332 })
    const sql = lastSql()
    expect(sql).toContain('"humanTypingAt"')
    expect(sql).toContain('"humanTypingUntil"')
    expect(sql).not.toContain('"aiState"')
    expect(sql).not.toContain('human_active')
  })

  it('is agency-scoped in the statement, not by a caller-side check', () => {
    void recordHumanTyping({ conversationId: 382, agencyId: 103 })
    const sql = lastSql()
    expect(sql).toContain('FROM inbox_conversations c')
    expect(sql).toContain('c."agencyId" = :agencyId')
    expect(lastBinds().agencyId).toBe(103)
  })

  it('takes the FURTHEST expiry so one tab cannot cut another tab short', () => {
    void recordHumanTyping({ conversationId: 382, agencyId: 103 })
    expect(lastSql()).toContain('GREATEST(conversation_ai_state."humanTypingUntil"')
  })

  it('always advances the keystroke marker to the newest beat', () => {
    // The marker is what the boundary compares against the turn epoch; it must
    // move forward on every beat, from any tab.
    void recordHumanTyping({ conversationId: 382, agencyId: 103 })
    expect(lastSql()).toMatch(/"humanTypingAt"\s*=\s*now\(\)/)
  })

  it('defaults to the shared TTL and clamps to whole seconds', () => {
    void recordHumanTyping({ conversationId: 382, agencyId: 103 })
    expect(lastBinds().ttlSeconds).toBe(Math.round(HUMAN_TYPING_TTL_MS / 1000))
    void recordHumanTyping({ conversationId: 382, agencyId: 103, ttlMs: 10 })
    expect(lastBinds().ttlSeconds).toBe(1)
  })
})

describe('the takeover write', () => {
  it('sets aiState=human_active and is agency-scoped', () => {
    void markHumanActiveByConversation(382, 103)
    const sql = lastSql()
    expect(sql).toContain(`'human_active'`)
    expect(sql).toContain('FROM inbox_conversations c')
    expect(sql).toContain('c."agencyId" = :agencyId')
  })

  it('upserts, so a conversation the agent never touched still records takeover', () => {
    void markHumanActiveByConversation(382, 103)
    expect(lastSql()).toContain('ON CONFLICT ("conversationId") DO UPDATE')
  })
})

describe('signalHumanTyping (the only browser-facing presence write)', () => {
  beforeEach(() => {
    vi.resetModules()
    requireAgencyUser.mockReset().mockResolvedValue({ id: 332, agencyId: 103 })
    recordHumanTypingSpy.mockReset().mockResolvedValue(true)
  })

  const load = async () => {
    vi.doMock('@/lib/requireUser', () => ({ requireAgencyUser, requireProductAccess: requireAgencyUser }))
    vi.doMock('@/db/conversationHumanPresence', () => ({
      recordHumanTyping: recordHumanTypingSpy,
      readHumanPresence: vi.fn(),
      markHumanActiveByConversation: vi.fn(),
    }))
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }))
    vi.doMock('@/db/inboxConversationReads', () => ({ markConversationRead: vi.fn() }))
    vi.doMock('@/db/inboxConversations', () => ({ deleteConversation: vi.fn() }))
    vi.doMock('@/lib/inbox/ensureWhatsappConversation', () => ({ ensureWhatsappConversationForLead: vi.fn() }))
    vi.doMock('@/modules/inbox/queries', () => ({
      getInboxConversationByLeadId: vi.fn(),
      listInboxConversations: vi.fn(),
    }))
    return import('@/modules/inbox/actions')
  }

  it('passes the SESSION agencyId, never a browser-supplied one', async () => {
    const { signalHumanTyping } = await load()
    await expect(signalHumanTyping(382)).resolves.toEqual({ ok: true })
    expect(recordHumanTypingSpy).toHaveBeenCalledWith({ conversationId: 382, agencyId: 103, userId: 332 })
  })

  it('reports failure for a conversation the session cannot reach', async () => {
    recordHumanTypingSpy.mockResolvedValue(false)
    const { signalHumanTyping } = await load()
    await expect(signalHumanTyping(999999)).resolves.toEqual({ ok: false })
  })

  it('rejects a malformed id without touching the database', async () => {
    const { signalHumanTyping } = await load()
    for (const bad of [0, -1, Number.NaN, 'abc']) {
      await expect(signalHumanTyping(bad as number)).resolves.toEqual({ ok: false })
    }
    expect(recordHumanTypingSpy).not.toHaveBeenCalled()
  })

  it('requires an authenticated agency user', async () => {
    requireAgencyUser.mockRejectedValue(new Error('no_agency'))
    const { signalHumanTyping } = await load()
    await expect(signalHumanTyping(382)).rejects.toThrow('no_agency')
    expect(recordHumanTypingSpy).not.toHaveBeenCalled()
  })
})
