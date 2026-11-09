import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { S3Client } from '@aws-sdk/client-s3'
import { db } from '@/config/db'

/**
 * The quote download route's real answer to each caller, through the real session
 * code: real JWT verification, user lookup, database and access rules. Only the
 * cookie, the trial state and R2's network call are stood in for.
 */

const h = vi.hoisted(() => ({ cookie: undefined as string | undefined, access: { status: 'PAID', hasAccess: true } }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined), delete: () => undefined }),
  headers: async () => new Headers(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f, cacheTag: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => h.access }))

import { GET } from '@/app/api/quotes/[quoteId]/download/route'
import { encrypt } from '@/db/auth'
import { StorageNotFoundError } from '@/lib/storage/objects'

const A = 9301
const B = 9302
const ADMIN = 93010
const OWNER_REP = 93011
const OTHER_REP = 93012
const SUSPENDED = 93013
const FOREIGN_ADMIN = 93020
const HANDLE = 'a'.repeat(64)
const FOREIGN_HANDLE = 'b'.repeat(64)
const FAILED_HANDLE = 'c'.repeat(64)
const PATH = `tenants/${A}/quotes/1/doc.pdf`
let quoteId = 0

const session = (id: number) => encrypt({ id, sv: 0, typ: 'session' })
const open = (handle: string = HANDLE) => GET(new NextRequest(`https://crm.test/api/quotes/${handle}/download`), { params: Promise.resolve({ quoteId: handle }) })
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason
let send: ReturnType<typeof vi.spyOn>

async function quote(agencyId: number, leadId: number, by: number, quoteNumber = 7) {
  const [q] = await db('sales_quotes')
    .insert({ agencyId, leadId, createdByUserId: by, status: 'ready', title: 't', quoteNumber, quoteYear: 2026, readyAt: new Date(), recipientNameSnapshot: 'דוד כהן', subtotalAmount: 100, taxAmount: 18, discountAmount: 0, totalAmount: 118 } as never)
    .returning('id')
  return Number(q.id)
}

beforeAll(async () => {
  for (const [agency, adminId] of [[A, ADMIN], [B, FOREIGN_ADMIN]]) {
    await db('agencies').insert({ id: agency, name: `a${agency}`, plan: 'pro', country: 'IL', defaultCurrency: 'ILS', locale: 'he' } as never)
    await db('users').insert({ id: adminId, agencyId: agency, email: `u${adminId}@t.test`, role: 'ADMIN', firstName: 'א', lastName: String(adminId) } as never)
  }
  await db('users').insert([OWNER_REP, OTHER_REP, SUSPENDED].map((id) => ({ id, agencyId: A, email: `u${id}@t.test`, role: 'AGNT', firstName: 'א', lastName: String(id), suspended: id === SUSPENDED })) as never)
  const [lead] = await db('clients').insert({ firstName: 'ל', lastName: 'ד', agencyId: A, createdById: OWNER_REP, userId: OWNER_REP } as never).returning('id')
  const [foreignLead] = await db('clients').insert({ firstName: 'ז', lastName: 'ר', agencyId: B, createdById: FOREIGN_ADMIN, userId: FOREIGN_ADMIN } as never).returning('id')
  quoteId = await quote(A, Number(lead.id), ADMIN)
  const failedOnly = await quote(A, Number(lead.id), ADMIN, 8)
  const foreign = await quote(B, Number(foreignLead.id), FOREIGN_ADMIN)
  await db('sales_quote_documents').insert([
    { agencyId: A, quoteId, status: 'ready', isCurrent: true, path: PATH, contentHash: HANDLE, byteSize: 10, readyAt: new Date() },
    { agencyId: B, quoteId: foreign, status: 'ready', isCurrent: true, path: `tenants/${B}/quotes/9/doc.pdf`, contentHash: FOREIGN_HANDLE, byteSize: 10, readyAt: new Date() },
    { agencyId: A, quoteId: failedOnly, status: 'failed', isCurrent: false, path: 'tenants/x.pdf', contentHash: FAILED_HANDLE, failureReason: 'render_error' },
  ] as never)
})
afterAll(async () => {
  await db('sales_quotes').whereIn('agencyId', [A, B]).delete()
  await db('clients').whereIn('agencyId', [A, B]).delete()
  await db('users').whereIn('agencyId', [A, B]).delete()
  await db('agencies').whereIn('id', [A, B]).delete()
  await db.destroy()
})
beforeEach(() => {
  vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32))
  vi.stubEnv('R2_ACCESS_KEY_ID', 'FAKEKEYID')
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'fake-secret')
  vi.stubEnv('R2_BUCKET_NAME', 'test-bucket')
  h.cookie = undefined
  h.access = { status: 'PAID', hasAccess: true }
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({ ContentLength: 10, ContentType: 'application/pdf' } as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('no valid session', () => {
  it('a signed-out owner goes to the login page, and nothing reaches storage', async () => {
    const res = await open()
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(send).not.toHaveBeenCalled()
  })
  it('answers the same whether or not the document exists', async () => {
    const [real, missing] = await Promise.all([open(), open('d'.repeat(64))])
    expect(missing.status).toBe(real.status)
    expect(missing.headers.get('location')).toBe(real.headers.get('location'))
  })
  it('a garbage cookie gets no document', async () => {
    h.cookie = 'not-a-token'
    expect((await open()).status).toBe(302)
    expect(send).not.toHaveBeenCalled()
  })
  it('a suspended user is 401', async () => {
    h.cookie = await session(SUSPENDED)
    const res = await open()
    expect(res.status).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('signed in, without access', () => {
  it('no product access is refused with its reason', async () => {
    h.cookie = await session(ADMIN)
    h.access = { status: 'TRIAL_EXPIRED', hasAccess: false }
    const res = await open()
    expect(res.status).toBe(403)
    expect(await reason(res)).toBe('subscription-required')
    expect(send).not.toHaveBeenCalled()
  })
  it('another agency, even its admin, finds nothing', async () => {
    h.cookie = await session(FOREIGN_ADMIN)
    const res = await open()
    expect(res.status).toBe(404)
    expect(await reason(res)).toBe('not_found')
    expect(send).not.toHaveBeenCalled()
  })
  it("an admin cannot reach another agency's handle from their own", async () => {
    h.cookie = await session(ADMIN)
    expect((await open(FOREIGN_HANDLE)).status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })
  it('a rep without the lead finds nothing', async () => {
    h.cookie = await session(OTHER_REP)
    expect((await open()).status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('handles', () => {
  it.each(['1', String(Number.MAX_SAFE_INTEGER), 'abc', "' OR 1=1 --", 'A'.repeat(64), 'a'.repeat(63)])('%s is not a handle', async (handle) => {
    h.cookie = await session(ADMIN)
    expect((await open(handle)).status).toBe(404)
  })
  it('the numeric quote id opens nothing', async () => {
    h.cookie = await session(ADMIN)
    expect((await open(String(quoteId))).status).toBe(404)
  })
  it('a failed render has no download', async () => {
    h.cookie = await session(ADMIN)
    expect((await open(FAILED_HANDLE)).status).toBe(404)
  })
})

describe('allowed', () => {
  const expectRedirect = async (res: Response) => {
    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('location')!)
    expect(url.hostname).toContain('r2.cloudflarestorage.com')
    expect(url.pathname).toContain(PATH)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60')
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf')
    const disposition = url.searchParams.get('response-content-disposition')!
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe('Quote-00007-דוד_כהן.pdf')
    expect(disposition).toContain('attachment; filename="Quote-00007-_______.pdf"')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  }
  it('the admin gets a 60-second private redirect', async () => {
    h.cookie = await session(ADMIN)
    await expectRedirect(await open())
  })
  it("the lead's own rep too", async () => {
    h.cookie = await session(OWNER_REP)
    await expectRedirect(await open())
  })
})

describe('a refused caller is never handed a link', () => {
  it.each([
    ['another agency, even its admin', FOREIGN_ADMIN],
    ['a rep without the lead', OTHER_REP],
  ])('%s: 404, no Location, no signing', async (_who, id) => {
    h.cookie = await session(id)
    const res = await open()
    expect(res.status).toBe(404)
    expect(res.headers.get('location')).toBeNull()
    expect(await res.text()).not.toMatch(/X-Amz|r2\.cloudflarestorage/)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('storage trouble', () => {
  it('a row whose object is gone is not found', async () => {
    h.cookie = await session(ADMIN)
    send.mockRejectedValueOnce(Object.assign(new StorageNotFoundError(), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }))
    expect((await open()).status).toBe(404)
  })
  it('R2 being down is a 503 with no detail', async () => {
    h.cookie = await session(ADMIN)
    send.mockRejectedValueOnce(Object.assign(new Error('secret-ish'), { $metadata: { httpStatusCode: 500 } }))
    const res = await open()
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain('secret-ish')
  })
})
