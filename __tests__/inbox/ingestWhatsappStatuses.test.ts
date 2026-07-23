import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  connection: undefined as { agency_id: number } | undefined,
  updateResult: 0,
  probeRow: undefined as Record<string, unknown> | undefined,
  lastUpdate: null as Record<string, unknown> | null,
  lastWhere: null as Record<string, unknown> | null,
  lastWhereIn: null as [string, string[]] | null,
  lastWhereRaw: null as [string, unknown[]] | null,
}

vi.mock('@/config/db', () => {
  const raw = (sql: string, bindings: unknown[]) => ({ __raw: sql, bindings })
  const builder = (table: string) => {
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      where: (w: Record<string, unknown>) => {
        if (table === 'inbox_messages') state.lastWhere = w
        return q
      },
      whereIn: (col: string, vals: string[]) => {
        state.lastWhereIn = [col, vals]
        return q
      },
      whereRaw: (sql: string, bindings: unknown[]) => {
        state.lastWhereRaw = [sql, bindings]
        return q
      },
      first: async () => (table === 'whatsapp_connections' ? state.connection : state.probeRow),
      update: async (patch: Record<string, unknown>) => {
        state.lastUpdate = patch
        return state.updateResult
      },
    })
    return q
  }
  const db = Object.assign((table: string) => builder(table), { raw })
  return { db }
})

const { ingestWhatsappStatuses } = await import('@/lib/inbox/ingestWhatsappStatuses')
const { canTransition, statusRank } = await import('@/lib/inbox/messageStatus')

const TS = '1784462400' // 2026-07-19T12:00:00.000Z

beforeEach(() => {
  state.connection = { agency_id: 103 }
  state.updateResult = 1
  state.probeRow = undefined
  state.lastUpdate = null
  state.lastWhere = null
  state.lastWhereIn = null
  state.lastWhereRaw = null
  vi.restoreAllMocks()
})

describe('SQL rank guard mirrors the TS ladder', () => {
  // The runtime guard is in SQL; canTransition is its TS twin. If these ever
  // disagree, one of them is silently wrong. This is what keeps them honest.
  const sqlRank = (s: string) => (s === 'sent' ? 1 : s === 'delivered' ? 2 : 0)
  const advanceable = ['sent', 'delivered'] as const
  const events = ['sent', 'delivered', 'read', 'failed'] as const

  it('agrees with canTransition for every current/next pair', () => {
    for (const current of ['received', 'sent', 'delivered', 'read', 'failed'] as const) {
      for (const next of events) {
        const sqlAllows =
          (advanceable as readonly string[]).includes(current) && sqlRank(current) < statusRank(next)
        expect(sqlAllows).toBe(canTransition(current, next))
      }
    }
  })
})

describe('ingestWhatsappStatuses — scoping', () => {
  it('scopes the update to agency, channel, wamid, and outbound direction', async () => {
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'delivered', timestamp: TS }])
    expect(state.lastWhere).toEqual({
      channel: 'whatsapp',
      externalId: 'wamid.A',
      agencyId: 103,
      direction: 'outbound',
    })
  })

  it('only advances rows currently in sent or delivered', async () => {
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'read', timestamp: TS }])
    expect(state.lastWhereIn).toEqual(['status', ['sent', 'delivered']])
  })

  it('applies the rank guard with the incoming rank as a binding', async () => {
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'delivered', timestamp: TS }])
    expect(state.lastWhereRaw?.[1]).toEqual([2])
    expect(state.lastWhereRaw?.[0]).toContain('CASE status')
  })

  it('does nothing when the phone number id is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestWhatsappStatuses(undefined, [{ id: 'wamid.A', status: 'sent', timestamp: TS }])
    expect(state.lastUpdate).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('does nothing when the phone number id resolves to no connection', async () => {
    state.connection = undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestWhatsappStatuses('9999', [{ id: 'wamid.A', status: 'sent', timestamp: TS }])
    expect(state.lastUpdate).toBeNull()
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'no_connection' })
  })
})

describe('ingestWhatsappStatuses — persistence', () => {
  it('writes the status and the matching lifecycle timestamp', async () => {
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'delivered', timestamp: TS }])
    expect(state.lastUpdate?.status).toBe('delivered')
    const patch = JSON.parse((state.lastUpdate?.metadata as { bindings: string[] }).bindings[0])
    expect(patch.deliveredAt).toBe('2026-07-19T12:00:00.000Z')
    expect(patch.lastStatusChangeAt).toBe('2026-07-19T12:00:00.000Z')
  })

  it('records sentAt from a sent event', async () => {
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'sent', timestamp: TS }])
    const patch = JSON.parse((state.lastUpdate?.metadata as { bindings: string[] }).bindings[0])
    expect(patch.sentAt).toBe('2026-07-19T12:00:00.000Z')
  })

  it('deep-merges into metadata.delivery so earlier timestamps survive', async () => {
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'read', timestamp: TS }])
    const sql = (state.lastUpdate?.metadata as { __raw: string }).__raw
    expect(sql).toContain('jsonb_set')
    expect(sql).toContain(`'{delivery}'`)
    expect(sql).toContain(`metadata->'delivery'`)
  })

  it('writes errorReason as a category key on failure, never a code or prose', async () => {
    await ingestWhatsappStatuses('1216762448189306', [
      { id: 'wamid.A', status: 'failed', timestamp: TS, errors: [{ code: 131047 }] },
    ])
    expect(state.lastUpdate?.errorReason).toBe('window_expired')
    const patch = JSON.parse((state.lastUpdate?.metadata as { bindings: string[] }).bindings[0])
    expect(patch.errorCode).toBe(131047)
    expect(patch.category).toBe('window_expired')
    expect(patch.failedAt).toBe('2026-07-19T12:00:00.000Z')
  })

  it('does not write errorReason for non-failed statuses', async () => {
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'delivered', timestamp: TS }])
    expect(state.lastUpdate).not.toHaveProperty('errorReason')
  })

  it('ignores status values Meta may add in future', async () => {
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'deleted', timestamp: TS }])
    expect(state.lastUpdate).toBeNull()
  })
})

describe('ingestWhatsappStatuses — misses are logged, never inserted', () => {
  it('unknown wamid → WARN with reason unknown_wamid', async () => {
    state.updateResult = 0
    state.probeRow = undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.X', status: 'failed', timestamp: TS, errors: [{ code: 131047 }] }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toMatchObject({
      reason: 'unknown_wamid',
      wamid: 'wamid.X',
      phoneNumberId: '1216762448189306',
      agencyId: 103,
      status: 'failed',
      errorCode: 131047,
    })
  })

  it('a row owned by another agency → WARN with reason foreign_agency', async () => {
    state.updateResult = 0
    state.probeRow = { id: 5, agencyId: 69, status: 'sent' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'read', timestamp: TS }])
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'foreign_agency' })
  })

  it('a correctly-rejected ladder transition → WARN with reason terminal_or_stale', async () => {
    state.updateResult = 0
    state.probeRow = { id: 5, agencyId: 103, status: 'read' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'failed', timestamp: TS }])
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'terminal_or_stale' })
  })

  it('never logs message content', async () => {
    state.updateResult = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.X', status: 'sent', timestamp: TS }])
    expect(JSON.stringify(warn.mock.calls[0][1])).not.toMatch(/text|body|message"/i)
  })
})

describe('ingestWhatsappStatuses — resilience', () => {
  it('a malformed entry does not drop the rest of the batch', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await ingestWhatsappStatuses('1216762448189306', [
      null,
      { status: 'read' }, // no wamid
      { id: 'wamid.A', status: 'delivered', timestamp: TS },
    ])
    expect(state.lastUpdate?.status).toBe('delivered')
  })

  it('falls back to server time and warns when the Meta timestamp is malformed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestWhatsappStatuses('1216762448189306', [{ id: 'wamid.A', status: 'delivered', timestamp: 'nope' }])
    const patch = JSON.parse((state.lastUpdate?.metadata as { bindings: string[] }).bindings[0])
    expect(typeof patch.deliveredAt).toBe('string')
    expect(warn.mock.calls.some((c) => (c[1] as { reason?: string })?.reason === 'malformed_timestamp')).toBe(true)
  })
})
