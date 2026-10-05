import { afterEach, describe, expect, it, vi } from 'vitest'
import { graphRequest } from '@/lib/facebook/graphClient'
import { GRAPH_BASE } from '@/lib/facebook/graph'
import { DEFAULT_ADS_API_VERSION, resolveAdsApiVersion, ADS_API_VERSION } from '@/lib/facebook/ads/apiVersion'
import { listAdAccounts, readInsights, readStatuses } from '@/lib/facebook/ads/insights'

/**
 * Regression: every ads read goes to the pinned Marketing API version, and no
 * other Meta integration moves with it. The ads report's null metrics came from
 * requests on the app-wide default v19.0 — a Marketing API version Meta removed
 * on 2025-02-04 — while the parser is correct against a real v26.0 response
 * (realV26Response.test.ts).
 */

const urls: URL[] = []
const realFetch = global.fetch
function fakeFetch(body: unknown = { data: [] }) {
  const f = vi.fn(async (url: unknown) => {
    urls.push(new URL(String(url)))
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  global.fetch = f as unknown as typeof fetch
  return f
}

afterEach(() => {
  urls.length = 0
  global.fetch = realFetch
})

describe('resolveAdsApiVersion', () => {
  it('defaults to v26.0, the version verified against a real response', () => {
    expect(DEFAULT_ADS_API_VERSION).toBe('v26.0')
    expect(resolveAdsApiVersion(undefined)).toBe('v26.0')
    expect(resolveAdsApiVersion('')).toBe('v26.0')
  })
  it('accepts only an explicit vNN.N override', () => {
    expect(resolveAdsApiVersion('v27.0')).toBe('v27.0')
    expect(resolveAdsApiVersion(' v27.0 ')).toBe('v27.0')
    for (const bad of ['26.0', 'v26', 'v26.0/../x', 'latest', 'v26.0?x=1']) expect(resolveAdsApiVersion(bad)).toBe('v26.0')
  })
  it('the test environment runs on the default', () => {
    expect(ADS_API_VERSION).toBe('v26.0')
  })
})

describe('graphRequest version', () => {
  it('without a version, uses the app-wide GRAPH_BASE exactly as before', async () => {
    fakeFetch({})
    await graphRequest({ path: '/me', token: 'T' })
    expect(urls[0].toString().startsWith(`${GRAPH_BASE}/me`)).toBe(true)
  })
  it('with a version, uses that version and nothing else', async () => {
    fakeFetch({})
    await graphRequest({ path: '/me', token: 'T', version: 'v26.0' })
    expect(urls[0].origin + urls[0].pathname).toBe('https://graph.facebook.com/v26.0/me')
  })
  it('a malformed version is a programming error', async () => {
    fakeFetch({})
    await expect(graphRequest({ path: '/me', token: 'T', version: 'v26.0/../v1' })).rejects.toThrow('invalid_graph_version')
    expect(urls).toHaveLength(0)
  })
})

describe('every ads read is on the pinned version, per object, never root /?ids=', () => {
  const onAdsVersion = () => urls.every((u) => u.origin === 'https://graph.facebook.com' && u.pathname.startsWith('/v26.0/'))

  it('ad accounts', async () => {
    fakeFetch({ data: [] })
    await listAdAccounts('T')
    expect(urls.map((u) => u.pathname)).toEqual(['/v26.0/me/adaccounts'])
  })
  it('insights', async () => {
    fakeFetch({ data: [] })
    await readInsights('T', 'act_1', { level: 'account' }, { what: 't' })
    expect(urls.map((u) => u.pathname)).toEqual(['/v26.0/act_1/insights'])
  })
  it('delivery status', async () => {
    fakeFetch({ effective_status: 'ACTIVE' })
    const out = await readStatuses('T', ['11', '12'])
    expect(out?.get('11')).toBe('ACTIVE')
    expect(urls.map((u) => u.pathname).sort()).toEqual(['/v26.0/11', '/v26.0/12'])
    expect(onAdsVersion()).toBe(true)
    expect(urls.some((u) => u.pathname === '/v26.0/' || u.searchParams.has('ids'))).toBe(false)
  })
})
