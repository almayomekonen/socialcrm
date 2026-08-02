import { vi } from 'vitest'

vi.mock('@/db/automations/suppressions', () => ({ addLeadSuppression: vi.fn(async () => {}) }))

import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/automations/unsubscribe/route'
import { addLeadSuppression } from '@/db/automations/suppressions'
import { signLeadUnsubscribe } from '@/lib/automations/unsubscribeToken'

// Lead unsubscribe (ADR-003, as amended): GET renders, POST mutates.
// Token-scoped to (agency, lead), idempotent, generic on every rejection,
// and provably disjoint from the platform's userId-keyed consent surface.

const AGENCY = 7
const LEAD = 42
const TOKEN = () => signLeadUnsubscribe(AGENCY, LEAD)

const url = (a: unknown, l: unknown, t: string) =>
  `https://app.example.com/api/automations/unsubscribe?a=${a}&l=${l}&t=${encodeURIComponent(t)}`

const get = (u: string) => GET(new NextRequest(u))

function post(fields: Record<string, string>) {
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.append(k, v)
  return POST(new NextRequest('https://app.example.com/api/automations/unsubscribe', { method: 'POST', body }))
}

const submit = (t = TOKEN(), a = String(AGENCY), l = String(LEAD)) => post({ a, l, t })

beforeEach(() => vi.mocked(addLeadSuppression).mockClear())

describe('GET renders a confirmation and NEVER mutates (scanner safety)', () => {
  it('a valid link shows the confirmation form without suppressing anything', async () => {
    const res = await get(url(AGENCY, LEAD, TOKEN()))
    expect(res.status).toBe(200)
    // The whole point of the amendment: a link fetch is not an unsubscribe.
    expect(addLeadSuppression).not.toHaveBeenCalled()
    const html = await res.text()
    expect(html).toContain('אישור ההסרה')
    expect(html).toContain('method="POST"')
    expect(html).toContain('dir="rtl"')
  })

  it('carries the token forward so the POST can be authorized', async () => {
    const html = await (await get(url(AGENCY, LEAD, TOKEN()))).text()
    expect(html).toContain(`name="t" value="${TOKEN()}"`)
    expect(html).toContain(`name="a" value="${AGENCY}"`)
    expect(html).toContain(`name="l" value="${LEAD}"`)
  })

  it('is not cached (prefetch/proxy hygiene)', async () => {
    const res = await get(url(AGENCY, LEAD, TOKEN()))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects an invalid link without rendering a form', async () => {
    const res = await get(url(AGENCY, LEAD, 'nope'))
    expect(res.status).toBe(400)
    expect(await res.text()).not.toContain('method="POST"')
    expect(addLeadSuppression).not.toHaveBeenCalled()
  })
})

describe('POST performs the suppression', () => {
  it('suppresses the (agency, lead) pair and confirms in Hebrew', async () => {
    const res = await submit()
    expect(res.status).toBe(200)
    expect(addLeadSuppression).toHaveBeenCalledWith(AGENCY, LEAD, 'unsubscribe_link')
    expect(await res.text()).toContain('הוסרת מרשימת התפוצה')
  })

  it('is idempotent — resubmission converges, never errors', async () => {
    const [a, b] = [await submit(), await submit()]
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(addLeadSuppression).toHaveBeenCalledTimes(2) // conflict-ignore at the store
  })
})

describe('rejections are generic and write nothing', () => {
  it('rejects a tampered token', async () => {
    const res = await submit('not-a-real-token')
    expect(res.status).toBe(400)
    expect(addLeadSuppression).not.toHaveBeenCalled()
  })

  it('rejects a token minted for another agency (tenant isolation)', async () => {
    const res = await submit(signLeadUnsubscribe(AGENCY + 1, LEAD))
    expect(res.status).toBe(400)
    expect(addLeadSuppression).not.toHaveBeenCalled()
  })

  it('rejects a token minted for another lead', async () => {
    const res = await submit(signLeadUnsubscribe(AGENCY, LEAD + 1))
    expect(res.status).toBe(400)
    expect(addLeadSuppression).not.toHaveBeenCalled()
  })

  it('rejects malformed or missing identifiers', async () => {
    for (const [a, l] of [
      ['abc', String(LEAD)],
      [String(AGENCY), '0'],
      ['', ''],
      ['-1', String(LEAD)],
    ] as const) {
      expect((await submit(TOKEN(), a, l)).status).toBe(400)
    }
    expect(addLeadSuppression).not.toHaveBeenCalled()
  })

  it('rejects a POST with no form body at all', async () => {
    const res = await POST(
      new NextRequest('https://app.example.com/api/automations/unsubscribe', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    expect(addLeadSuppression).not.toHaveBeenCalled()
  })

  it('gives one identical response for every rejection (no enumeration oracle)', async () => {
    const bad = await submit('bad')
    const wrongTenant = await submit(signLeadUnsubscribe(999, LEAD))
    expect(await bad.text()).toBe(await wrongTenant.text())
  })
})
