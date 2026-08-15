import { describe, it, expect, beforeEach, vi } from 'vitest'

// Capture what the knex query builder is asked to do, without a real DB.
const cap = vi.hoisted(() => ({
  tables: [] as string[],
  lastWhere: null as Record<string, unknown> | null,
  delResult: 0,
  delCalled: false,
}))

vi.mock('@/config/db', () => {
  const builder = (table: string) => {
    cap.tables.push(table)
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      where: (w: Record<string, unknown>) => {
        cap.lastWhere = w
        return q
      },
      del: async () => {
        cap.delCalled = true
        return cap.delResult
      },
    })
    return q
  }
  const db = Object.assign((table: string) => builder(table), { raw: () => ({}) })
  return { db }
})

import { deleteConversation } from '@/db/inboxConversations'

beforeEach(() => {
  cap.tables = []
  cap.lastWhere = null
  cap.delResult = 0
  cap.delCalled = false
})

describe('deleteConversation (db helper)', () => {
  it('deletes ONLY from inbox_conversations, scoped by id AND agencyId (IDOR guard)', async () => {
    cap.delResult = 1
    const res = await deleteConversation({ conversationId: 42, agencyId: 7 })
    expect(cap.tables).toEqual(['inbox_conversations'])
    expect(cap.lastWhere).toEqual({ id: 42, agencyId: 7 })
    expect(cap.delCalled).toBe(true)
    expect(res).toEqual({ deleted: true })
  })

  it('never touches clients or ai_conversations — the Lead is preserved for every conversation kind', async () => {
    // Children (inbox_messages/participants/reads) go via ON DELETE CASCADE, so the
    // helper issues exactly one DELETE and can never reach the Lead or AI rows.
    cap.delResult = 1
    await deleteConversation({ conversationId: 1, agencyId: 1 })
    expect(cap.tables).toEqual(['inbox_conversations'])
    expect(cap.tables).not.toContain('clients')
    expect(cap.tables).not.toContain('ai_conversations')
  })

  it('is idempotent: 0 rows affected (already deleted / other agency) → { deleted: false }', async () => {
    cap.delResult = 0
    const res = await deleteConversation({ conversationId: 999, agencyId: 7 })
    expect(res).toEqual({ deleted: false })
  })
})
