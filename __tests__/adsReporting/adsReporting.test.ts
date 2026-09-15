/**
 * Ad performance reporting (ads_read) — read-only contract.
 *
 *  · date ranges are validated and mapped to Meta's own parameters;
 *  · accounts page by cursor, never by Meta's token-bearing `paging.next` URL;
 *  · "no rows" is NO ACTIVITY (totals null), distinct from every error;
 *  · permission / token / throttling errors are distinct reasons;
 *  · metrics Meta omitted stay null — nothing is fabricated as 0;
 *  · the token is only ever in the Authorization header;
 *  · no ads_management scope and no write call to the Marketing API exist.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.META_APP_SECRET = 'app-secret'
})

import { insightsRangeParams, parseAdsRange } from '@/lib/facebook/ads/dateRange'
import { listAdAccounts } from '@/lib/facebook/ads/insights'
import { getAdsReport } from '@/lib/facebook/ads/report'
import { formatAdsCount, formatAdsMoney, formatAdsPercent } from '@/lib/facebook/ads/format'

type Call = { url: string; init: RequestInit }
let calls: Call[] = []

function mockGraph(handler: (url: URL) => { status?: number; body: unknown }) {
  calls = []
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const { status = 200, body } = handler(new URL(String(url)))
    return { ok: status < 400, status, json: async () => body }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  calls = []
})

describe('date range', () => {
  const today = '2026-09-14'

  it('presets pass through as Meta date_preset (evaluated in the ad account timezone)', () => {
    expect(parseAdsRange({ range: 'last_7d' }, today)).toEqual({ range: { kind: 'preset', preset: 'last_7d' }, invalid: false })
    expect(insightsRangeParams({ kind: 'preset', preset: 'this_month' })).toEqual({ date_preset: 'this_month' })
  })

  it('a valid custom range becomes time_range; a future end is clamped to today', () => {
    const { range } = parseAdsRange({ range: 'custom', since: '2026-08-01', until: '2026-12-31' }, today)
    expect(range).toEqual({ kind: 'custom', since: '2026-08-01', until: '2026-09-14' })
    expect(insightsRangeParams(range)).toEqual({ time_range: JSON.stringify({ since: '2026-08-01', until: '2026-09-14' }) })
  })

  it.each([
    [{ range: 'custom', since: '2026-09-10', until: '2026-09-01' }, 'reversed'],
    [{ range: 'custom', since: '2026-02-30', until: '2026-03-01' }, 'not a real day'],
    [{ range: 'custom', since: '2023-01-01', until: '2023-02-01' }, 'beyond 37 months'],
    [{ range: 'custom', since: "2026-01-01'; --", until: '2026-02-01' }, 'injection'],
    [{ range: 'maximum' }, 'unsupported preset'],
  ])('%o (%s) → default range, flagged invalid', (input, _why) => {
    expect(parseAdsRange(input, today)).toEqual({ range: { kind: 'preset', preset: 'last_30d' }, invalid: true })
  })
})

describe('listAdAccounts', () => {
  it('follows cursors, never paging.next, and keeps the token out of every URL', async () => {
    mockGraph((url) => {
      if (!url.searchParams.get('after')) {
        return {
          body: {
            data: [{ id: 'act_1', name: 'חשבון ראשי', currency: 'ILS', account_status: 1 }, { id: 'not-an-account' }],
            paging: { cursors: { after: 'CURSOR2' }, next: 'https://graph.facebook.com/v26.0/me/adaccounts?access_token=LEAKED&after=CURSOR2' },
          },
        }
      }
      return { body: { data: [{ id: 'act_2', currency: 'USD', account_status: 2 }], paging: { cursors: {} } } }
    })

    const result = await listAdAccounts('USER-TOKEN')
    expect(result).toEqual({
      ok: true,
      value: [
        { id: 'act_1', name: 'חשבון ראשי', currency: 'ILS', timezone: null, status: 1 },
        { id: 'act_2', name: 'act_2', currency: 'USD', timezone: null, status: 2 },
      ],
    })
    expect(calls).toHaveLength(2)
    expect(new URL(calls[1].url).searchParams.get('after')).toBe('CURSOR2')
    for (const c of calls) {
      expect(c.url).not.toContain('USER-TOKEN')
      expect(c.url).not.toContain('LEAKED')
      expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer USER-TOKEN')
      expect(c.init.method).toBe('GET')
    }
  })

  it('an expired token is reconnect_required, not an empty account list', async () => {
    mockGraph(() => ({ status: 400, body: { error: { code: 190, message: 'expired' } } }))
    expect(await listAdAccounts('T')).toEqual({ ok: false, reason: 'reconnect_required' })
  })
})

describe('getAdsReport', () => {
  const range = { kind: 'preset', preset: 'last_30d' } as const

  it('an empty data array is NO ACTIVITY (totals null) — not an error', async () => {
    mockGraph(() => ({ body: { data: [] } }))
    expect(await getAdsReport('T', 'act_1', range)).toEqual({
      ok: true,
      value: { period: null, totals: null, previous: null, daily: [], campaigns: [], statusesAvailable: true, reducedFields: false },
    })
    // No delivery: nothing else is asked of Meta.
    expect(calls).toHaveLength(1)
  })

  it.each([
    [{ code: 200, message: 'Permissions error' }, 'permission_missing'],
    [{ code: 10, message: 'not allowed' }, 'permission_missing'],
    [{ code: 190 }, 'reconnect_required'],
    [{ code: 17 }, 'rate_limited'],
    [{ code: 80004, message: 'too many calls to this ad-account' }, 'rate_limited'],
    [{ code: 2 }, 'meta_error'],
  ])('Meta error %o → %s (never rendered as zero spend)', async (error, reason) => {
    mockGraph(() => ({ status: 400, body: { error } }))
    expect(await getAdsReport('T', 'act_1', range)).toEqual({ ok: false, reason })
  })

  it('a malformed account id never reaches Graph', async () => {
    mockGraph(() => ({ body: { data: [] } }))
    expect(await getAdsReport('T', 'act_1/../me', range)).toEqual({ ok: false, reason: 'permission_missing' })
    expect(await getAdsReport('T', '123', range)).toEqual({ ok: false, reason: 'permission_missing' })
    expect(calls).toHaveLength(0)
  })
})

describe('formatting', () => {
  it('missing values render as a dash, never as 0', () => {
    expect(formatAdsMoney(null, 'ILS')).toBe('—')
    expect(formatAdsCount(null)).toBe('—')
    expect(formatAdsPercent(null)).toBe('—')
    expect(formatAdsCount(0)).toBe('0')
    expect(formatAdsMoney(12.5, 'ILS')).toMatch(/12\.5/)
  })
})

describe('read-only guard (source)', () => {
  const ROOTS = ['app', 'lib', 'modules', 'components', 'actions', 'db']
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
  }
  ROOTS.forEach((r) => walk(join(process.cwd(), r)))

  it('no code requests the ads_management permission', () => {
    // Comment lines are ignored: several files document that it is NOT requested.
    const code = (f: string) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join('\n')
    const offenders = files.filter((f) => /ads_management/.test(code(f)))
    expect(offenders).toEqual([])
  })

  it('ad reporting code never issues a POST/DELETE against an ad account or campaign', () => {
    for (const file of ['insights.ts', 'report.ts', 'breakdown.ts']) {
      const src = readFileSync(join(process.cwd(), 'lib/facebook/ads', file), 'utf8')
      expect(src, file).not.toMatch(/method:\s*'(POST|DELETE)'/)
    }
  })
})
