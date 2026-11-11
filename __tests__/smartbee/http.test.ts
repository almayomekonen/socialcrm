import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSmartbeeTokenCache, smartbeeToken } from '@/lib/integrations/providers/smartbee/auth'
import { checkSmartbeeConnection, connectionVerdict, createSmartbeeDocument, pollSmartbeeDocument } from '@/lib/integrations/providers/smartbee/documents'
import type { SmartbeeDocumentBody } from '@/lib/integrations/providers/smartbee/types'

/**
 * SmartBee over a mocked fetch: every documented result code, auth, timeouts.
 * No request leaves the process.
 */

type Call = { url: string; method: string; headers: Record<string, string>; body: any }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const LOGIN = () => json({ token: 'jwt-1', expirationUtcDate: new Date(Date.now() + 7 * 864e5).toISOString() })

function fake(...replies: ((call: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const next = replies.shift()
    if (!next) throw new Error(`unexpected request ${url}`)
    return next(call)
  })
  return { calls, deps: { fetchImpl: impl as unknown as typeof fetch } }
}

const body: SmartbeeDocumentBody = {
  providerMsgId: 'scrm-test-act_1',
  providerMsgReferenceId: 'scrm-a1-l1',
  customer: { name: 'יוסי כהן' },
  docType: 'Receipt',
  receiptDetails: { cashItems: [{ sum: 100 }] },
  comments: 'x',
  isDraft: false,
  createDraftOnFailure: false,
  creationMetadata: { language: 'HEB', sendOriginalToCustomer: false },
}

beforeEach(() => {
  __resetSmartbeeTokenCache()
  process.env.SMARTBEE_TEST_CLIENT_ID = 'client-test'
  process.env.SMARTBEE_TEST_CLIENT_PASSWORD = 'pw-test'
})
afterEach(() => {
  for (const k of ['SMARTBEE_TEST_CLIENT_ID', 'SMARTBEE_TEST_CLIENT_PASSWORD', 'SMARTBEE_PRODUCTION_ENABLED']) delete process.env[k]
})

describe('authentication', () => {
  it('logs in with our client credentials on the sandbox host, caches the JWT, sends it as Bearer', async () => {
    const f = fake(LOGIN, () => json({ resultCodeId: 101, result: 'msg-1', validationErrors: null }), () => json({ resultCodeId: 101, result: 'msg-2', validationErrors: null }))
    await createSmartbeeDocument('test', body, 'biz-token', f.deps)
    await createSmartbeeDocument('test', { ...body, providerMsgId: 'scrm-test-act_2' }, 'biz-token', f.deps)
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://test.smartbee.co.il/api/v1/login/authenticate',
      'https://test.smartbee.co.il/api/v1/documents/create',
      'https://test.smartbee.co.il/api/v1/documents/create',
    ])
    expect(f.calls[0].body).toEqual({ clientId: 'client-test', password: 'pw-test' })
    expect(f.calls[1].headers.Authorization).toBe('Bearer jwt-1')
    expect(f.calls[1].body.providerUserToken).toBe('biz-token')
  })
  it('re-logs in when the token is within an hour of expiry', async () => {
    const soon = () => json({ token: 'jwt-old', expirationUtcDate: new Date(Date.now() + 30 * 60_000).toISOString() })
    const f = fake(soon, LOGIN)
    expect(await smartbeeToken('test', f.deps)).toBe('jwt-old')
    expect(await smartbeeToken('test', f.deps)).toBe('jwt-1')
  })
  it('on 401: one fresh login and one repeat, never a loop', async () => {
    const f = fake(LOGIN, () => json({}, 401), LOGIN, () => json({}, 401))
    expect(await createSmartbeeDocument('test', body, 'biz', f.deps)).toEqual({ kind: 'retry', reason: 'http_401', code: null })
    expect(f.calls).toHaveLength(4)
  })
  it('bad client credentials → retry with a named reason (nothing was sent to create)', async () => {
    const f = fake(() => json({}, 400))
    expect(await createSmartbeeDocument('test', body, 'biz', f.deps)).toEqual({ kind: 'retry', reason: 'auth_invalid_credentials', code: null })
    expect(f.calls).toHaveLength(1)
  })
  it('missing client credentials → no request at all', async () => {
    delete process.env.SMARTBEE_TEST_CLIENT_ID
    const f = fake()
    expect(await createSmartbeeDocument('test', body, 'biz', f.deps)).toEqual({ kind: 'retry', reason: 'auth_missing_credentials', code: null })
    expect(f.calls).toHaveLength(0)
  })
  it('production is refused unless explicitly enabled: no request to smartbee.co.il', async () => {
    process.env.SMARTBEE_PROD_CLIENT_ID = 'p'
    process.env.SMARTBEE_PROD_CLIENT_PASSWORD = 'p'
    const f = fake()
    expect(await createSmartbeeDocument('production', body, 'biz', f.deps)).toMatchObject({ kind: 'retry', reason: 'auth_production_disabled' })
    expect(f.calls).toHaveLength(0)
    delete process.env.SMARTBEE_PROD_CLIENT_ID
    delete process.env.SMARTBEE_PROD_CLIENT_PASSWORD
  })
})

describe('create: every documented answer', () => {
  const create = async (reply: () => Response) => createSmartbeeDocument('test', body, 'biz', fake(LOGIN, reply).deps)
  it('101 queued', async () => expect(await create(() => json({ resultCodeId: 101, result: 'm1', validationErrors: null }))).toEqual({ kind: 'accepted', providerRef: 'm1', duplicate: false }))
  it('95 duplicate → the ORIGINAL message id', async () => expect(await create(() => json({ resultCodeId: 95, result: 'm-orig', validationErrors: null }))).toEqual({ kind: 'accepted', providerRef: 'm-orig', duplicate: true }))
  it('98 bad business token → rejected', async () => expect(await create(() => json({ resultCodeId: 98, result: null, validationErrors: null }))).toMatchObject({ kind: 'rejected', reason: 'invalid_provider_token' }))
  it('99 → retry with the same id', async () => expect(await create(() => json({ resultCodeId: 99, result: null, validationErrors: null }))).toMatchObject({ kind: 'retry', reason: 'server_error' }))
  it('HTTP 400 validation → rejected with the fields', async () =>
    expect(await create(() => json({ errors: { 'Customer.Name': ['The Name field is required.'] } }, 400))).toEqual({
      kind: 'rejected',
      reason: 'validation',
      code: 400,
      details: { 'Customer.Name': ['The Name field is required.'] },
    }))
  it('429 / 503 / 500 → retry', async () => {
    for (const s of [429, 503, 500]) {
      __resetSmartbeeTokenCache()
      expect(await create(() => json({}, s))).toMatchObject({ kind: 'retry', reason: `http_${s}` })
    }
  })
  it('timeout → retry, never a failure', async () => {
    const f = fake(LOGIN, () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' })
    })
    expect(await createSmartbeeDocument('test', body, 'biz', f.deps)).toEqual({ kind: 'retry', reason: 'transport_timeout', code: null })
  })
  it('an undocumented code is never success', async () => expect(await create(() => json({ resultCodeId: 102, result: 'x', validationErrors: null }))).toMatchObject({ kind: 'retry', reason: 'unexpected_code' }))
  it('a 2xx that is not JSON → retry', async () => expect(await create(() => new Response('<html>', { status: 200 }))).toMatchObject({ kind: 'retry', reason: 'transport_invalid_json' }))
})

describe('poll: every documented answer', () => {
  const poll = async (reply: () => Response) => pollSmartbeeDocument('test', 'msg-1', fake(LOGIN, reply).deps)
  const env = (resultCodeId: number, result: unknown = null, validationErrors: unknown = null) => () => json({ resultCodeId, result, validationErrors })
  it('1 processing', async () => expect(await poll(env(1))).toEqual({ kind: 'processing' }))
  it('102 created: id, number, allocation number, both links', async () =>
    expect(await poll(env(102, { docType: 'Receipt', documentId: 'd1', index: 500042, taxConfirmationNumber: '2026123', linkToOriginal: 'https://o', linkToCopy: 'https://c' }))).toEqual({
      kind: 'created',
      document: { providerDocumentId: 'd1', number: '500042', allocationNumber: '2026123', originalUrl: 'https://o', copyUrl: 'https://c' },
    }))
  it('102 without an id or number is not trusted', async () => expect(await poll(env(102, { documentId: 'd1' }))).toMatchObject({ kind: 'retry', reason: 'created_without_identity' }))
  it('103 draft', async () => expect(await poll(env(103, { draftDocumentId: 'dr1' }))).toEqual({ kind: 'draft', draftId: 'dr1' }))
  it('96 / 94 / 104 are failures with their reason; 97 is uncertain', async () => {
    expect(await poll(env(96, null, { ReceiptPaymentDocument: 'not equal' }))).toEqual({ kind: 'failed', reason: 'validation', code: 96, details: { ReceiptPaymentDocument: 'not equal' } })
    __resetSmartbeeTokenCache()
    expect(await poll(env(94))).toMatchObject({ kind: 'failed', reason: 'api_plan_unavailable' })
    __resetSmartbeeTokenCache()
    expect(await poll(env(104))).toMatchObject({ kind: 'failed', reason: 'creation_disabled' })
    __resetSmartbeeTokenCache()
    // 97 is NOT proof that no document exists: retried, never failed.
    expect(await poll(env(97))).toEqual({ kind: 'retry', reason: 'unknown_message', code: 97 })
  })
  it('99 / 199 → retry', async () => expect(await poll(env(199))).toMatchObject({ kind: 'retry', reason: 'server_error' }))
  it('GET by the message id', async () => {
    const f = fake(LOGIN, env(1))
    await pollSmartbeeDocument('test', 'a/b', f.deps)
    expect(f.calls[1]).toMatchObject({ method: 'GET', url: 'https://test.smartbee.co.il/api/v1/documents/a%2Fb' })
  })
})

describe('connection check', () => {
  it('120 valid, 98 invalid token, else error', async () => {
    expect(await checkSmartbeeConnection('test', 't', fake(LOGIN, () => json({ resultCodeId: 120, result: {}, validationErrors: null })).deps)).toEqual({ kind: 'valid' })
    __resetSmartbeeTokenCache()
    expect(await checkSmartbeeConnection('test', 't', fake(LOGIN, () => json({ resultCodeId: 98, result: null, validationErrors: null })).deps)).toEqual({ kind: 'invalid_token' })
  })
})

/** The exact answers the real sandbox gave on 2026-11-11 (docs/smartbee-sandbox-checklist.md). */
describe('connection check: real sandbox answers', () => {
  const SEARCH_94 = { resultCodeId: 94, result: {}, validationErrors: { NotAuthorized: 'Required roles not found for action: documents/search' } }
  const SEARCH_98 = { resultCodeId: 98, result: null, validationErrors: null }
  const SEARCH_120 = { resultCodeId: 120, result: {}, validationErrors: null }
  const TOKEN = 'business-token-SECRET-81e8'
  const check = (reply: unknown) => checkSmartbeeConnection('test', TOKEN, fake(LOGIN, () => json(reply)).deps)

  it('94 naming documents/search → token recognized, search unavailable; stored, never called a working search', async () => {
    const c = await check(SEARCH_94)
    expect(c).toEqual({ kind: 'recognized_search_unavailable' })
    const v = connectionVerdict('test', c)
    expect(v.ok).toBe(true)
    expect(v.message).toMatch(/recognized/)
    expect(v.message).toMatch(/Search is NOT available/)
    expect(v.message).not.toMatch(/verified \(search available\)/)
  })
  it('98 → invalid token, refused', async () => {
    const c = await check(SEARCH_98)
    expect(c).toEqual({ kind: 'invalid_token' })
    expect(connectionVerdict('test', c)).toMatchObject({ ok: false, message: expect.stringMatching(/98/) })
  })
  it('120 → verified with search, as before', async () => {
    const c = await check(SEARCH_120)
    expect(c).toEqual({ kind: 'valid' })
    expect(connectionVerdict('test', c)).toEqual({ ok: true, message: 'SmartBee test: business token verified (search available)' })
  })
  it.each([
    ['94 without the search wording (e.g. no API plan)', { resultCodeId: 94, result: null, validationErrors: { NotAuthorized: 'API plan required' } }, 'code_94'],
    ['94 with no validation errors', { resultCodeId: 94, result: null, validationErrors: null }, 'code_94'],
    ['101 on a search', { resultCodeId: 101, result: 'x', validationErrors: null }, 'code_101'],
    ['99 server error', { resultCodeId: 99, result: null, validationErrors: null }, 'code_99'],
    ['no envelope', { hello: 1 }, 'invalid_envelope'],
  ])('%s → fails closed', async (_n, reply, reason) => {
    const c = await check(reply)
    expect(c).toEqual({ kind: 'error', reason })
    expect(connectionVerdict('test', c).ok).toBe(false)
  })
  it('HTTP 500 / 429 → fails closed', async () => {
    expect(await checkSmartbeeConnection('test', TOKEN, fake(LOGIN, () => json({}, 500)).deps)).toEqual({ kind: 'error', reason: 'http_500' })
    __resetSmartbeeTokenCache()
    expect(await checkSmartbeeConnection('test', TOKEN, fake(LOGIN, () => json({}, 429)).deps)).toEqual({ kind: 'error', reason: 'http_429' })
  })
  it('94 is still a failure for poll: the search exception never leaks into issuance', async () => {
    const r = await pollSmartbeeDocument('test', 'm1', fake(LOGIN, () => json(SEARCH_94)).deps)
    expect(r).toMatchObject({ kind: 'failed', code: 94 })
  })
  it('no credential or token reaches the console or the verdicts', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const verdicts = []
    for (const reply of [SEARCH_94, SEARCH_98, SEARCH_120, { resultCodeId: 7 }]) {
      __resetSmartbeeTokenCache()
      verdicts.push(connectionVerdict('test', await check(reply)).message)
    }
    const printed = [...spies.flatMap((s) => s.mock.calls.flat().map(String)), ...verdicts].join('\n')
    spies.forEach((s) => s.mockRestore())
    for (const secret of [TOKEN, 'pw-test', 'client-test', 'jwt-1']) expect(printed).not.toContain(secret)
  })
})
