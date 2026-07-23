import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  connection: undefined as { agency_id: number } | undefined,
  updateResult: 1,
  lastTable: '',
  lastWhere: null as Record<string, unknown> | null,
  lastUpdate: null as Record<string, unknown> | null,
}

vi.mock('@/config/db', () => {
  const builder = (table: string) => {
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      where: (w: Record<string, unknown>) => {
        if (table === 'whatsapp_templates') state.lastWhere = w
        return q
      },
      first: async () => (table === 'whatsapp_connections' ? state.connection : undefined),
      update: async (patch: Record<string, unknown>) => {
        state.lastUpdate = patch
        return state.updateResult
      },
    })
    return q
  }
  const db = Object.assign((table: string) => ((state.lastTable = table), builder(table)), { fn: { now: () => 'NOW()' } })
  return { db }
})

const { ingestTemplateStatusUpdate } = await import('@/lib/whatsapp/templates/ingestStatus')

beforeEach(() => {
  state.connection = { agency_id: 103 }
  state.updateResult = 1
  state.lastWhere = null
  state.lastUpdate = null
  vi.restoreAllMocks()
})

describe('ingestTemplateStatusUpdate — identity + adoption', () => {
  it('APPROVED → status approved, updated by (wabaId, name, language)', async () => {
    await ingestTemplateStatusUpdate('WABA_1', 'message_template_status_update', {
      event: 'APPROVED',
      message_template_name: 'follow_up',
      message_template_language: 'he',
    })
    expect(state.lastWhere).toEqual({ wabaId: 'WABA_1', name: 'follow_up', language: 'he' })
    expect(state.lastUpdate).toMatchObject({ status: 'approved', rejectionReason: null })
  })

  it('REJECTED → status rejected + mapped rejection key (never the raw reason)', async () => {
    await ingestTemplateStatusUpdate('WABA_1', 'message_template_status_update', {
      event: 'REJECTED',
      message_template_name: 'promo',
      message_template_language: 'he',
      reason: 'ABUSIVE_CONTENT',
    })
    expect(state.lastUpdate).toMatchObject({ status: 'rejected', rejectionReason: 'policy' })
    expect(JSON.stringify(state.lastUpdate)).not.toContain('ABUSIVE_CONTENT')
  })

  it('quality update → touches only qualityRating, not status', async () => {
    await ingestTemplateStatusUpdate('WABA_1', 'message_template_quality_update', {
      message_template_name: 'follow_up',
      message_template_language: 'he',
      new_quality_score: 'RED',
    })
    expect(state.lastUpdate).toMatchObject({ qualityRating: 'RED' })
    expect(state.lastUpdate).not.toHaveProperty('status')
  })

  it('is idempotent: re-applying the same event issues the same identity-keyed update', async () => {
    const ev = { event: 'APPROVED', message_template_name: 'follow_up', message_template_language: 'he' }
    await ingestTemplateStatusUpdate('WABA_1', 'message_template_status_update', ev)
    const first = { ...state.lastWhere, ...state.lastUpdate }
    await ingestTemplateStatusUpdate('WABA_1', 'message_template_status_update', ev)
    expect({ ...state.lastWhere, ...state.lastUpdate }).toEqual(first)
  })
})

describe('ingestTemplateStatusUpdate — misses are logged, never inserted', () => {
  it('unknown template (0 rows) → WARN, no throw, no insert', async () => {
    state.updateResult = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestTemplateStatusUpdate('WABA_1', 'message_template_status_update', {
      event: 'APPROVED',
      message_template_name: 'ghost',
      message_template_language: 'he',
    })
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'unknown_template', wabaId: 'WABA_1', name: 'ghost' })
  })

  it('no WABA → WARN + ignore, no DB touch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestTemplateStatusUpdate(undefined, 'message_template_status_update', { event: 'APPROVED', message_template_name: 'x' })
    expect(state.lastUpdate).toBeNull()
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'no_waba' })
  })

  it('WABA with no connection → WARN + ignore', async () => {
    state.connection = undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestTemplateStatusUpdate('WABA_X', 'message_template_status_update', {
      event: 'APPROVED',
      message_template_name: 'x',
      message_template_language: 'he',
    })
    expect(state.lastUpdate).toBeNull()
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'no_connection' })
  })

  it('missing template name → WARN + ignore', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ingestTemplateStatusUpdate('WABA_1', 'message_template_status_update', { event: 'APPROVED' })
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'no_template_name' })
  })
})
