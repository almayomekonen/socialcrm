import { describe, it, expect, vi } from 'vitest'
import { runWabaBackfill, type BackfillDeps } from '../../scripts/backfill_waba_id'

type Row = { id: number; phone_number_id: string; access_token: string }

function deps(rows: Row[], resolveMap: Record<string, string | null>): BackfillDeps & {
  setCalls: [number, string][]
} {
  const setCalls: [number, string][] = []
  return {
    setCalls,
    list: async () => rows,
    resolve: async (_token: string, phone: string) => resolveMap[phone] ?? null,
    set: async (id: number, wabaId: string) => {
      setCalls.push([id, wabaId])
      return 1
    },
  }
}

describe('runWabaBackfill', () => {
  it('resolves and sets waba_id for each missing connection', async () => {
    const d = deps(
      [
        { id: 1, phone_number_id: 'P1', access_token: 't1' },
        { id: 2, phone_number_id: 'P2', access_token: 't2' },
      ],
      { P1: 'WABA_1', P2: 'WABA_2' },
    )
    const res = await runWabaBackfill(d)
    expect(res).toEqual({ scanned: 2, set: 2, unresolved: 0 })
    expect(d.setCalls).toEqual([
      [1, 'WABA_1'],
      [2, 'WABA_2'],
    ])
  })

  it('skips and counts rows whose WABA cannot be resolved (never calls set for them)', async () => {
    const d = deps(
      [
        { id: 1, phone_number_id: 'P1', access_token: 't1' },
        { id: 2, phone_number_id: 'P2', access_token: 't2' },
      ],
      { P1: 'WABA_1', P2: null },
    )
    const res = await runWabaBackfill(d)
    expect(res).toEqual({ scanned: 2, set: 1, unresolved: 1 })
    expect(d.setCalls).toEqual([[1, 'WABA_1']])
  })

  it('dry-run resolves but never writes', async () => {
    const d = deps([{ id: 1, phone_number_id: 'P1', access_token: 't1' }], { P1: 'WABA_1' })
    const res = await runWabaBackfill(d, { dryRun: true })
    expect(res).toEqual({ scanned: 1, set: 0, unresolved: 0 })
    expect(d.setCalls).toEqual([])
  })

  it('is a no-op when nothing is missing (idempotent re-run)', async () => {
    const resolve = vi.fn()
    const set = vi.fn()
    const res = await runWabaBackfill({ list: async () => [], resolve, set })
    expect(res).toEqual({ scanned: 0, set: 0, unresolved: 0 })
    expect(resolve).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('counts a row as not-set when set reports 0 rows updated (already filled concurrently)', async () => {
    const setCalls: [number, string][] = []
    const res = await runWabaBackfill({
      list: async () => [{ id: 1, phone_number_id: 'P1', access_token: 't1' }],
      resolve: async () => 'WABA_1',
      set: async (id, wabaId) => {
        setCalls.push([id, wabaId])
        return 0 // whereNull guard matched nothing → already set
      },
    })
    expect(res).toEqual({ scanned: 1, set: 0, unresolved: 0 })
    expect(setCalls).toEqual([[1, 'WABA_1']])
  })
})
