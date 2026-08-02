import { vi } from 'vitest'

vi.mock('@/db/automations/suppressions', () => ({ addLeadSuppression: vi.fn(async () => {}) }))

import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/automations/unsubscribe/route'
import { addLeadSuppression } from '@/db/automations/suppressions'
import { signLeadUnsubscribe } from '@/lib/automations/unsubscribeToken'

// Lead unsubscribe route (ADR-003): token-scoped to (agency, lead), idempotent,
// generic on every rejection, and provably disjoint from the platform's
// userId-keyed consent surface (spec §0).

const AGENCY = 7
const LEAD = 42

const url = (a: unknown, l: unknown, t: string) =>
  `https://app.example.com/api/automations/unsubscribe?a=${a}&l=${l}&t=${encodeURIComponent(t)}`

const call = (u: string) => GET(new NextRequest(u))

beforeEach(() => vi.mocked(addLeadSuppression).mockClear())

describe('valid unsubscribe', () => {
  it('suppresses the (agency, lead) pair and confirms in Hebrew', async () => {
    const res = await call(url(AGENCY, LEAD, signLeadUnsubscribe(AGENCY, LEAD)))
    expect(res.status).toBe(200)
    expect(addLeadSuppression).toHaveBeenCalledWith(AGENCY, LEAD, 'unsubscribe_link')
    const html = await res.text()
    expect(html).toContain('הוסרת מרשימת התפוצה')
    expect(html).toContain('dir="rtl"')
  })

  it('is not cached (prefetch/proxy hygiene)', async () => {
    const res = await call(url(AGENCY, LEAD, signLeadUnsubscribe(AGENCY, LEAD)))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('is idempotent — repeated clicks converge, never error', async () => {
    const link = url(AGENCY, LEAD, signLeadUnsubscribe(AGENCY, LEAD))
    const [a, b] = [await call(link), await call(link)]
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(addLeadSuppression).toHaveBeenCalledTimes(2) // conflict-ignore at the store
  })
})

describe('rejections are generic and write nothing', () => {
  it('rejects a tampered token', async () => {
    const res = await call(url(AGENCY, LEAD, 'not-a-real-token'))
    expect(res.status).toBe(400)
    expect(addLeadSuppression).not.toHaveBeenCalled()
    expect(await res.text()).toContain('הקישור אינו תקין')
  })

  it('rejects a token minted for another agency (tenant isolation)', async () => {
    const res = await call(url(AGENCY, LEAD, signLeadUnsubscribe(AGENCY + 1, LEAD)))
    expect(res.status).toBe(400)
    expect(addLeadSuppression).not.toHaveBeenCalled()
  })

  it('rejects a token minted for another lead', async () => {
    const res = await call(url(AGENCY, LEAD, signLeadUnsubscribe(AGENCY, LEAD + 1)))
    expect(res.status).toBe(400)
    expect(addLeadSuppression).not.toHaveBeenCalled()
  })

  it('rejects malformed or missing identifiers', async () => {
    for (const [a, l] of [
      ['abc', LEAD],
      [AGENCY, '0'],
      ['', ''],
      [-1, LEAD],
    ] as const) {
      const res = await call(url(a, l, signLeadUnsubscribe(AGENCY, LEAD)))
      expect(res.status).toBe(400)
    }
    expect(addLeadSuppression).not.toHaveBeenCalled()
  })

  it('gives one identical response for every rejection (no enumeration oracle)', async () => {
    const bad = await call(url(AGENCY, LEAD, 'bad'))
    const wrongTenant = await call(url(AGENCY, LEAD, signLeadUnsubscribe(999, LEAD)))
    expect(await bad.text()).toBe(await wrongTenant.text())
  })
})
