import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { S3Client } from '@aws-sdk/client-s3'
import { SignJWT } from 'jose'
import { db } from '@/config/db'

/**
 * The route's real answer to each kind of caller, through the real session code: real
 * JWT verification, real user lookup, real database, real access rules. Only the
 * request's cookie, the trial state and R2's network call are stood in for.
 */

const h = vi.hoisted(() => ({ cookie: undefined as string | undefined, access: { status: 'PAID', hasAccess: true } }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined), delete: () => undefined }),
  headers: async () => new Headers(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f, cacheTag: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => h.access }))

import { GET } from '@/app/api/billing/invoice/[invoiceId]/download/route'
import { encrypt } from '@/db/auth'

const A = 9201
const B = 9202
const ADMIN = 92010
const OWNER_REP = 92011
const OTHER_REP = 92012
const FOREIGN_ADMIN = 92020
const SUSPENDED = 92013
const INVOICE = 920001
const NOT_RENDERED = 920002
const PATH = `tenants/${A}/invoices/${INVOICE}/doc.pdf`

const session = (id: number) => encrypt({ id, sv: 0, typ: 'session' })
const open = (id: number | string = INVOICE) =>
  GET(new NextRequest(`https://crm.test/api/billing/invoice/${id}/download`), { params: Promise.resolve({ invoiceId: String(id) }) })
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason

let send: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  for (const [agency, adminId] of [[A, ADMIN], [B, FOREIGN_ADMIN]]) {
    await db('agencies').insert({ id: agency, name: `a${agency}`, plan: 'pro', country: 'IL', defaultCurrency: 'ILS', locale: 'he' } as never)
    await db('users').insert({ id: adminId, agencyId: agency, email: `u${adminId}@t.test`, role: 'ADMIN', firstName: 'א', lastName: String(adminId) } as never)
  }
  await db('users').insert(
    [OWNER_REP, OTHER_REP, SUSPENDED].map((id) => ({ id, agencyId: A, email: `u${id}@t.test`, role: 'AGNT', firstName: 'א', lastName: String(id), suspended: id === SUSPENDED })) as never,
  )
  const [lead] = await db('clients').insert({ firstName: 'ל', lastName: 'ד', agencyId: A, createdById: OWNER_REP, userId: OWNER_REP } as never).returning('id')
  await db.transaction(async (trx) => {
    // The route reads these rows and nothing they point at, so their FKs are switched off locally.
    await trx.raw(`SET LOCAL session_replication_role = replica`)
    const invoice = { agencyId: A, leadId: lead.id, billingProfileId: 1, createdByUserId: ADMIN, docState: 'issued', kind: 'invoice', legalNameSnapshot: 'בדיקה', documentYear: 2026, issuedAt: new Date(), issuedByUserId: ADMIN, fulfillState: 'open' }
    await trx('bill_invoices').insert([{ id: INVOICE, documentNumber: 1, ...invoice }, { id: NOT_RENDERED, documentNumber: 2, ...invoice }] as never)
    await trx('bill_documents').insert({ agencyId: A, invoiceId: INVOICE, status: 'ready', isCurrent: true, url: `/api/billing/invoice/${INVOICE}/download`, path: PATH } as never)
  })
})

afterAll(async () => {
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL session_replication_role = replica`)
    await trx('bill_documents').where({ agencyId: A }).delete()
    await trx('bill_invoices').where({ agencyId: A }).delete()
  })
  await db('clients').where({ agencyId: A }).delete()
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
  send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({ ContentLength: 10, ContentType: 'application/pdf' } as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('callers with no valid session', () => {
  const refusedAsUnauthorized = async () => {
    const res = await open()
    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await reason(res)).toBe('unauthorized')
    expect(send).not.toHaveBeenCalled()
  }

  it('anonymous is 401, not a crash', async () => {
    await refusedAsUnauthorized()
  })

  it('answers the same whether or not the invoice exists', async () => {
    const [real, missing] = await Promise.all([open(), open(999999999)])
    expect(missing.status).toBe(real.status)
    expect(await missing.text()).toBe(await real.text())
  })

  it('a garbage cookie is 401', async () => {
    h.cookie = 'not-a-token'
    await refusedAsUnauthorized()
  })

  it('a session signed with another key is 401', async () => {
    h.cookie = await new SignJWT({ id: ADMIN, sv: 0, typ: 'session' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1d')
      .sign(new TextEncoder().encode('a-different-environments-key'))
    await refusedAsUnauthorized()
  })

  it('another token type signed with the right key is 401', async () => {
    h.cookie = await encrypt({ id: ADMIN, typ: 'fb_pages' })
    await refusedAsUnauthorized()
  })

  it('a suspended user is 401', async () => {
    h.cookie = await session(SUSPENDED)
    await refusedAsUnauthorized()
  })
})

describe('valid sessions without access', () => {
  it('an agency without product access is refused with its reason, and the gate is kept', async () => {
    h.cookie = await session(ADMIN)
    h.access = { status: 'TRIAL_EXPIRED', hasAccess: false }
    const res = await open()
    expect(res.status).toBe(403)
    expect(await reason(res)).toBe('subscription-required')
    expect(send).not.toHaveBeenCalled()
  })

  it('another agency sees not found, even as its admin', async () => {
    h.cookie = await session(FOREIGN_ADMIN)
    const res = await open()
    expect(res.status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('a rep without permission over the lead is refused', async () => {
    h.cookie = await session(OTHER_REP)
    const res = await open()
    expect(res.status).toBe(403)
    expect(await reason(res)).toBe('no_access')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('authorized callers', () => {
  const landsOnTheInvoice = async () => {
    const res = await open()
    expect(res.status).toBe(302)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const url = new URL(res.headers.get('location') as string)
    expect(url.hostname).toContain('r2.cloudflarestorage.com')
    expect(url.pathname).toContain(PATH)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60')
  }

  it('the admin gets a 60-second link to this invoice', async () => {
    h.cookie = await session(ADMIN)
    await landsOnTheInvoice()
  })

  it('the lead owner gets one too', async () => {
    h.cookie = await session(OWNER_REP)
    await landsOnTheInvoice()
  })

  it('an invoice with no finished PDF is not found', async () => {
    h.cookie = await session(ADMIN)
    const res = await open(NOT_RENDERED)
    expect(res.status).toBe(404)
    expect(await reason(res)).toBe('pdf_not_ready')
  })
})
