/**
 * Creatives, top ads, ranges and the read-through snapshot cache — pure parts
 * and Graph/DB seams stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  snapshots: new Map<string, { payload: unknown; fetchedAt: Date }>(),
  writes: [] as { key: string; payload: unknown }[],
  graph: vi.fn(),
  failWrite: false,
}))

vi.mock('@/db/adsSnapshots', () => ({
  readSnapshot: async (_scope: unknown, key: string) => h.snapshots.get(key) ?? null,
  readSnapshots: async (_scope: unknown, keys: string[]) =>
    new Map(keys.filter((k) => h.snapshots.has(k)).map((k) => [k, h.snapshots.get(k)!])),
  writeSnapshot: async (_scope: unknown, key: string, payload: unknown) => {
    if (h.failWrite) throw new Error('db down')
    h.writes.push({ key, payload })
  },
}))
vi.mock('@/lib/facebook/graphClient', async (orig) => ({
  ...(await orig<typeof import('@/lib/facebook/graphClient')>()),
  graphRequest: (...args: unknown[]) => h.graph(...args),
}))

import { creativeOf, getAdCreatives } from '@/lib/facebook/ads/creatives'
import { cachedAdsRead, CREATIVE_TTL_MS, reportTtlMs, STALE_MAX_MS } from '@/lib/facebook/ads/cached'
import { topAdsOf } from '@/lib/facebook/ads/topAds'
import { parseAdsRange, rangeDays, rangeKey } from '@/lib/facebook/ads/dateRange'

const NOW = new Date('2026-10-06T10:00:00Z')
const SCOPE = { agencyId: 103, accountId: 'act_1' }

beforeEach(() => {
  h.snapshots.clear()
  h.writes = []
  h.graph.mockReset()
  h.failWrite = false
})

describe('creativeOf — creative image mapping', () => {
  it('an image ad shows its image; a video ad shows its thumbnail', () => {
    expect(creativeOf({ image_url: 'https://cdn/img.jpg', thumbnail_url: 'https://cdn/t.jpg', object_type: 'PHOTO' })).toEqual({
      imageUrl: 'https://cdn/img.jpg',
      isVideo: false,
    })
    expect(creativeOf({ image_url: 'https://cdn/img.jpg', thumbnail_url: 'https://cdn/t.jpg', video_id: '9' })).toEqual({
      imageUrl: 'https://cdn/t.jpg',
      isVideo: true,
    })
  })

  it('falls back to the thumbnail, keeps https only, and never invents a URL', () => {
    expect(creativeOf({ thumbnail_url: 'https://cdn/t.jpg' }).imageUrl).toBe('https://cdn/t.jpg')
    expect(creativeOf({ image_url: 'http://cdn/img.jpg' }).imageUrl).toBeNull()
    expect(creativeOf(undefined)).toEqual({ imageUrl: null, isVideo: false })
  })
})

describe('getAdCreatives — two documented reads per ad, one object per request, cached per ad', () => {
  // GET /{id} per object (Graph v26 removed `GET /?ids=`); responses keyed by the object asked for.
  const objects: Record<string, unknown> = {
    '/11': { id: '11', creative: { id: '901' } },
    '/12': { id: '12', creative: { id: '902' } },
    '/901': { id: '901', image_url: 'https://cdn/a.jpg' },
    '/902': { id: '902', thumbnail_url: 'https://cdn/v.jpg', object_type: 'VIDEO' },
  }
  const perObject = (req: { path: string }) => Promise.resolve({ ok: true, data: objects[req.path] })

  it('reads ad → creative → image per object, on the ads API version, asking for a 600px thumbnail', async () => {
    h.graph.mockImplementation(perObject)
    const out = await getAdCreatives(SCOPE, 'TOKEN', ['11', '12'], NOW)
    expect(out.get('11')).toEqual({ imageUrl: 'https://cdn/a.jpg', isVideo: false })
    expect(out.get('12')).toEqual({ imageUrl: 'https://cdn/v.jpg', isVideo: true })
    const reqs = h.graph.mock.calls.map((c) => c[0])
    expect(reqs.map((r) => r.path).sort()).toEqual(['/11', '/12', '/901', '/902'])
    expect(reqs.every((r) => r.version === 'v26.0' && !('ids' in (r.query ?? {})))).toBe(true)
    expect(reqs.filter((r) => r.path === '/11')[0].query).toEqual({ fields: 'creative{id}' })
    expect(reqs.filter((r) => r.path === '/901')[0].query).toMatchObject({ thumbnail_width: 600, thumbnail_height: 600 })
    expect(h.writes.map((w) => w.key).sort()).toEqual(['11', '12'])
  })

  it('an ad Meta says is gone (100/33) gets the fallback; the others still load', async () => {
    h.graph.mockImplementation((req: { path: string }) =>
      req.path === '/12'
        ? Promise.resolve({ ok: false, error: { kind: 'graph', status: 400, code: 100, subcode: 33, type: null, message: null } })
        : perObject(req),
    )
    const out = await getAdCreatives(SCOPE, 'TOKEN', ['11', '12'], NOW)
    expect(out.get('11')?.imageUrl).toBe('https://cdn/a.jpg')
    expect(out.get('12')).toEqual({ imageUrl: null, isVideo: false })
  })

  it('a fresh cached creative costs no Graph call', async () => {
    h.snapshots.set('11', { payload: { imageUrl: 'https://cdn/a.jpg', isVideo: false }, fetchedAt: NOW })
    const out = await getAdCreatives(SCOPE, 'TOKEN', ['11'], NOW)
    expect(out.get('11')?.imageUrl).toBe('https://cdn/a.jpg')
    expect(h.graph).not.toHaveBeenCalled()
  })

  it('a failed refresh keeps the older creative; an ad with nothing becomes a fallback, not an error', async () => {
    h.snapshots.set('11', {
      payload: { imageUrl: 'https://cdn/old.jpg', isVideo: false },
      fetchedAt: new Date(NOW.getTime() - CREATIVE_TTL_MS - 1),
    })
    h.graph.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'graph', status: 500, code: 2, subcode: null, type: null, message: null },
    })
    const out = await getAdCreatives(SCOPE, 'TOKEN', ['11', '12'], NOW)
    expect(out.get('11')?.imageUrl).toBe('https://cdn/old.jpg')
    expect(out.has('12')).toBe(false)
  })

  it('never sends an id that is not a Meta object id', async () => {
    const out = await getAdCreatives(SCOPE, 'TOKEN', ['act_1', '../x', ''], NOW)
    expect(out.size).toBe(0)
    expect(h.graph).not.toHaveBeenCalled()
  })
})

describe('cachedAdsRead — snapshot cache and stale fallback', () => {
  const scope = { ...SCOPE, kind: 'report' as const }
  const fetched = vi.fn()

  beforeEach(() => fetched.mockReset())

  it('fresh snapshot → served without calling Meta', async () => {
    h.snapshots.set('k', { payload: { spend: 1 }, fetchedAt: new Date(NOW.getTime() - 60_000) })
    const res = await cachedAdsRead(scope, 'k', 30 * 60_000, fetched, NOW)
    expect(res).toEqual({
      ok: true,
      value: { value: { spend: 1 }, fetchedAt: new Date(NOW.getTime() - 60_000).toISOString(), stale: false },
    })
    expect(fetched).not.toHaveBeenCalled()
  })

  it('old or missing snapshot → Meta is asked and the answer stored', async () => {
    fetched.mockResolvedValue({ ok: true, value: { spend: 2 } })
    const res = await cachedAdsRead(scope, 'k', 30 * 60_000, fetched, NOW)
    expect(res).toMatchObject({ ok: true, value: { value: { spend: 2 }, stale: false } })
    expect(h.writes).toEqual([{ key: 'k', payload: { spend: 2 } }])
  })

  it('Meta down or rate-limited → the last good answer, flagged stale', async () => {
    h.snapshots.set('k', { payload: { spend: 1 }, fetchedAt: new Date(NOW.getTime() - 2 * 3600_000) })
    for (const reason of ['meta_error', 'rate_limited']) {
      fetched.mockResolvedValueOnce({ ok: false, reason })
      expect(await cachedAdsRead(scope, 'k', 30 * 60_000, fetched, NOW)).toMatchObject({ ok: true, value: { stale: true } })
    }
  })

  it('an auth or permission failure is never covered by cached data', async () => {
    h.snapshots.set('k', { payload: { spend: 1 }, fetchedAt: new Date(NOW.getTime() - 2 * 3600_000) })
    for (const reason of ['reconnect_required', 'permission_missing']) {
      fetched.mockResolvedValueOnce({ ok: false, reason })
      expect(await cachedAdsRead(scope, 'k', 30 * 60_000, fetched, NOW)).toEqual({ ok: false, reason })
    }
  })

  it('a snapshot older than the stale limit is not served', async () => {
    h.snapshots.set('k', { payload: { spend: 1 }, fetchedAt: new Date(NOW.getTime() - STALE_MAX_MS - 1) })
    fetched.mockResolvedValueOnce({ ok: false, reason: 'meta_error' })
    expect(await cachedAdsRead(scope, 'k', 30 * 60_000, fetched, NOW)).toEqual({ ok: false, reason: 'meta_error' })
  })

  it('a cache write failure never fails the report', async () => {
    h.failWrite = true
    fetched.mockResolvedValue({ ok: true, value: { spend: 3 } })
    expect(await cachedAdsRead(scope, 'k', 30 * 60_000, fetched, NOW)).toMatchObject({ ok: true, value: { value: { spend: 3 } } })
  })
})

describe('ranges', () => {
  const today = '2026-10-06'
  it('"today" is a preset Meta understands', () => {
    expect(parseAdsRange({ range: 'today' }, today)).toEqual({ range: { kind: 'preset', preset: 'today' }, invalid: false })
  })

  it('presets resolve to Meta-style explicit days', () => {
    const days = (preset: string) => rangeDays(parseAdsRange({ range: preset }, today).range, today)
    expect(days('today')).toEqual({ since: today, until: today })
    expect(days('last_7d')).toEqual({ since: '2026-09-29', until: '2026-10-05' })
    expect(days('last_30d')).toEqual({ since: '2026-09-06', until: '2026-10-05' })
    expect(days('this_month')).toEqual({ since: '2026-10-01', until: today })
    expect(days('last_month')).toEqual({ since: '2026-09-01', until: '2026-09-30' })
  })

  it('a preset cache key changes with the day; "today" refreshes faster', () => {
    const r = parseAdsRange({ range: 'last_7d' }, today).range
    expect(rangeKey(r, today)).not.toBe(rangeKey(r, '2026-10-07'))
    expect(reportTtlMs(rangeKey(parseAdsRange({ range: 'today' }, today).range, today))).toBeLessThan(
      reportTtlMs(rangeKey(r, today)),
    )
  })
})

describe('topAdsOf — ad rows', () => {
  it('keeps ad rows only, sorted by spend, with campaign context', () => {
    const rows = topAdsOf([
      {
        ad_id: '1',
        ad_name: 'זול',
        campaign_id: '7',
        campaign_name: 'C',
        objective: 'OUTCOME_LEADS',
        spend: '10',
        impressions: '100',
      },
      {
        ad_id: '2',
        ad_name: 'יקר',
        campaign_id: '7',
        campaign_name: 'C',
        objective: 'OUTCOME_LEADS',
        spend: '90',
        impressions: '900',
        actions: [{ action_type: 'lead', value: '3' }],
      },
      { campaign_id: '7', spend: '999' },
    ])
    expect(rows.map((r) => r.id)).toEqual(['2', '1'])
    expect(rows[0]).toMatchObject({ name: 'יקר', campaignName: 'C', result: { kind: 'leads', count: 3, cost: 30 } })
  })
})
