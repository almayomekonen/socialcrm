import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { normalizeEnvelope, postGrowForm, GrowTransportError } from '@/lib/payments/grow/http'
import {
  createTokenOnlyProcess,
  getPaymentProcessInfo,
  chargeToken,
  lookupTokenTransactionsRaw,
  GrowApiError,
} from '@/lib/payments/grow/api'

/**
 * Fixture values are copied from Grow's reference pages (response examples),
 * not invented: regular-payment-response, response-get-payment-info,
 * token-transactions-response, token, parameter-mapping.
 */

const fetchMock = vi.fn()
const holder = { fullName: 'John Smith', phone: '0501234567', email: 'owner@example.com' }

function growResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function sent(i = 0): { url: string; form: FormData } {
  const [url, init] = fetchMock.mock.calls[i]
  return { url: String(url), form: init.body as FormData }
}

beforeEach(() => {
  vi.stubEnv('GROW_MODE', 'sandbox')
  vi.stubEnv('GROW_USER_ID', 'user-1')
  vi.stubEnv('GROW_PAGE_CODE_TOKEN', 'page-1')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('normalizeEnvelope', () => {
  it('reads the documented success envelope (status as string or number)', () => {
    expect(normalizeEnvelope({ err: '', status: '1', data: { a: 1 } })).toEqual({ status: 1, err: null, data: { a: 1 } })
  })
  it('reads the documented failure envelope', () => {
    expect(normalizeEnvelope({ err: { id: 54, message: 'חסרים שדות חובה: pageCode' }, status: 0, data: '' })).toEqual({
      status: 0,
      err: { id: 54, message: 'חסרים שדות חובה: pageCode' },
      data: '',
    })
  })
  it.each([[{}], [[]], [null], ['ok'], [{ status: 'success', data: {} }], [{ status: 2, data: {} }], [{ message: 'Internal error' }]])(
    'throws invalid_envelope for a body that is not the documented envelope: %j (unknown outcome, never a Grow refusal)',
    (body) => {
      expect(() => normalizeEnvelope(body)).toThrow(expect.objectContaining({ name: 'GrowTransportError', reason: 'invalid_envelope' }))
    },
  )
})

describe('postGrowForm transport', () => {
  it('posts multipart form data to the mode base URL', async () => {
    fetchMock.mockResolvedValue(growResponse({ status: 1, err: '', data: {} }))
    await postGrowForm('someMethod', { a: 'x', n: 3 })
    const { url, form } = sent()
    expect(url).toBe('https://sandbox.meshulam.co.il/api/light/server/1.0/someMethod')
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('n')).toBe('3')
  })
  it('maps a timeout to GrowTransportError(timeout)', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    await expect(postGrowForm('x', {})).rejects.toMatchObject({ name: 'GrowTransportError', reason: 'timeout' })
  })
  it('maps a non-2xx response to GrowTransportError(http_status)', async () => {
    fetchMock.mockResolvedValue(new Response('bad gateway', { status: 502 }))
    const err = await postGrowForm('x', {}).catch((e) => e)
    expect(err).toBeInstanceOf(GrowTransportError)
    expect(err.httpStatus).toBe(502)
  })
  it('maps a non-JSON body to GrowTransportError(invalid_json)', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }))
    await expect(postGrowForm('x', {})).rejects.toMatchObject({ reason: 'invalid_json' })
  })
  it('maps a timeout while reading the body to GrowTransportError(timeout), not invalid_json', async () => {
    const stalled = { ok: true, status: 200, type: 'basic', json: () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })) }
    fetchMock.mockResolvedValue(stalled)
    await expect(postGrowForm('x', {})).rejects.toMatchObject({ reason: 'timeout' })
  })
  it('never follows redirects: the form would be re-sent to the Location host', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 307, headers: { location: 'https://attacker.example/collect' } }))
    await expect(postGrowForm('x', { cardToken: 'ct' })).rejects.toMatchObject({ name: 'GrowTransportError', reason: 'redirect', httpStatus: 307 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
  })
  it('treats an opaque redirect response as a redirect', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 0, type: 'opaqueredirect', json: async () => ({}) })
    await expect(postGrowForm('x', {})).rejects.toMatchObject({ reason: 'redirect' })
  })
})

describe('createTokenOnlyProcess (Get Token Only)', () => {
  it('sends the documented Get Token Only fields and returns the documented response fields', async () => {
    fetchMock.mockResolvedValue(
      growResponse({
        status: 1,
        err: '',
        data: { processId: '734754', processToken: '2153287cd9af46457ae842337250b78d', url: 'https://sandbox.meshulam.co.il/far?l=89a71a421b8e0686024fbb762dab61e1' },
      }),
    )
    const res = await createTokenOnlyProcess({
      holder,
      reference: 'abc123',
      description: 'SocialCRM Pro אמצעי תשלום',
      successUrl: 'https://s.example.com/billing/success?source=card_trial',
      cancelUrl: 'https://s.example.com/dashboard',
      notifyUrl: 'https://s.example.com/api/payments/grow/notify',
    })
    expect(res).toEqual({
      processId: '734754',
      processToken: '2153287cd9af46457ae842337250b78d',
      url: 'https://sandbox.meshulam.co.il/far?l=89a71a421b8e0686024fbb762dab61e1',
    })
    const { url, form } = sent()
    expect(url).toBe('https://sandbox.meshulam.co.il/api/light/server/1.0/createPaymentProcess')
    expect(form.get('pageCode')).toBe('page-1')
    expect(form.get('userId')).toBe('user-1')
    expect(form.get('chargeType')).toBe('3')
    expect(form.get('sum')).toBe('1')
    expect(form.get('saveCardToken')).toBe('1')
    expect(form.get('cField1')).toBe('abc123')
    expect(form.get('notifyUrl')).toBe('https://s.example.com/api/payments/grow/notify')
    expect(form.get('pageField[fullName]')).toBe('John Smith')
    expect(form.get('pageField[phone]')).toBe('0501234567')
    expect(form.get('pageField[email]')).toBe('owner@example.com')
  })

  it('omits notifyUrl and email when not provided', async () => {
    fetchMock.mockResolvedValue(growResponse({ status: 1, err: '', data: { processId: '1', processToken: 't', url: 'https://u' } }))
    await createTokenOnlyProcess({ holder: { ...holder, email: null }, reference: 'r', description: 'd', successUrl: 's', cancelUrl: 'c', notifyUrl: '' })
    expect(sent().form.has('notifyUrl')).toBe(false)
    expect(sent().form.has('pageField[email]')).toBe(false)
  })

  it('throws GrowApiError with the documented error id on status 0', async () => {
    fetchMock.mockResolvedValue(growResponse({ err: { id: 54, message: 'חסרים שדות חובה: pageCode' }, status: 0, data: '' }))
    const err = await createTokenOnlyProcess({ holder, reference: 'r', description: 'd', successUrl: 's', cancelUrl: 'c', notifyUrl: 'n' }).catch((e) => e)
    expect(err).toBeInstanceOf(GrowApiError)
    expect(err.errorId).toBe(54)
  })
})

describe('getPaymentProcessInfo', () => {
  it('maps transactions[] from the documented response example (a paid transaction)', async () => {
    fetchMock.mockResolvedValue(
      growResponse({
        status: 1,
        err: '',
        data: {
          processId: '1234122',
          processToken: 'dc4de4d5ae45cc22dbb7s2s5s1s2s5s4s1',
          customField: [],
          transactions: [
            {
              asmachta: '30012345', cardSuffix: '1234', cardBrand: 'Visa', cardExp: '1120', status: 'שולם', statusCode: '2',
              sum: '3', cardToken: 'e18ec3fa5dd331d0f030ss5d5d4ds5s5d41d', transactionId: '33123456', transactionToken: '9ac26ed383f9c1e7e8absds54ds54s8d',
            },
          ],
        },
      }),
    )
    const txs = await getPaymentProcessInfo({ processId: '1234122', processToken: 'dc4de4d5ae45cc22dbb7s2s5s1s2s5s4s1' })
    expect(txs).toEqual([
      {
        transactionId: '33123456', transactionToken: '9ac26ed383f9c1e7e8absds54ds54s8d', statusCode: '2', sum: '3',
        cardToken: 'e18ec3fa5dd331d0f030ss5d5d4ds5s5d41d', cardSuffix: '1234', cardBrand: 'Visa', cardExp: '1120',
      },
    ])
    expect(sent().url.endsWith('/getPaymentProcessInfo')).toBe(true)
    expect(sent().form.get('pageCode')).toBe('page-1')
    expect(sent().form.get('processId')).toBe('1234122')
  })

  it('returns an empty list when the documented transactions array is absent', async () => {
    fetchMock.mockResolvedValue(growResponse({ status: 1, err: '', data: { processId: '1' } }))
    expect(await getPaymentProcessInfo({ processId: '1', processToken: 't' })).toEqual([])
  })
})

describe('chargeToken (createTransactionWithToken)', () => {
  const input = { cardToken: 'ct', holder, sum: 89, description: 'SocialCRM Pro מנוי חודשי', uniqueIdentifier: 1790000001 }

  it('reports paid only for statusCode 2 ("paid" in parameter-mapping), using the documented response example', async () => {
    fetchMock.mockResolvedValue(
      growResponse({ status: 1, err: '', data: { asmachta: '293942875', status: 'שולם', statusCode: 2, transactionId: 32324365, transactionToken: 'bfc899df35258d5b87126e049614ff76' } }),
    )
    expect(await chargeToken(input)).toEqual({
      kind: 'paid',
      transactionId: '32324365',
      transactionToken: 'bfc899df35258d5b87126e049614ff76',
      asmachta: '293942875',
      statusCode: '2',
    })
    const { url, form } = sent()
    expect(url.endsWith('/createTransactionWithToken')).toBe(true)
    expect(form.get('userId')).toBe('user-1')
    expect(form.get('paymentType')).toBe('2')
    expect(form.get('paymentNum')).toBe('1')
    expect(form.get('sum')).toBe('89')
    expect(form.get('transactionUniqueIdentifier')).toBe('1790000001')
  })

  /**
   * Grow, in writing on 2026-09-17: a token charge must carry exactly ONE of
   * transactionUniqueIdentifier or transactionGroupIdentifier, never both.
   *
   * We send the unique one, because that is the identifier Grow actually
   * refuses a repeat on — errorId 1010, observed in the sandbox run. The group
   * identifier still exists on the charge row and still groups the attempts of
   * one billing period; it simply never reaches Grow.
   *
   * `absent`, not empty: a present-but-blank field is still a second identifier
   * as far as the request is concerned.
   */
  it('sends transactionUniqueIdentifier ONLY — no group identifier, not even an empty one', async () => {
    fetchMock.mockResolvedValue(growResponse({ status: 1, err: '', data: { statusCode: 2, transactionId: 1 } }))
    await chargeToken(input)
    const { form } = sent()
    expect(form.get('transactionUniqueIdentifier')).toBe('1790000001')
    expect(form.has('transactionGroupIdentifier')).toBe(false)
    expect([...form.keys()].filter((k) => k.toLowerCase().includes('identifier'))).toEqual(['transactionUniqueIdentifier'])
  })

  it('carries the identifier exactly, never rounded', async () => {
    fetchMock.mockResolvedValue(growResponse({ status: 1, err: '', data: { statusCode: 2, transactionId: 1 } }))
    await chargeToken({ ...input, uniqueIdentifier: 9007199254740991 })
    expect(sent().form.get('transactionUniqueIdentifier')).toBe('9007199254740991')
  })

  it.each([
    [{ statusCode: '0', transactionId: '9' }, { statusCode: '0', transactionId: '9' }],
    [{ statusCode: '11', transactionId: '9' }, { statusCode: '11', transactionId: '9' }],
    [{ transactionId: '9' }, { statusCode: null, transactionId: '9' }],
    [{ statusCode: '2' }, { statusCode: '2', transactionId: null }],
    [{}, { statusCode: null, transactionId: null }],
  ])('reports unrecognized — outcome unknown, not a decline — for a status-1 answer outside the documented paid shape: %j', async (data, expected) => {
    fetchMock.mockResolvedValue(growResponse({ status: 1, err: '', data }))
    expect(await chargeToken(input)).toEqual({ kind: 'unrecognized', ...expected })
  })

  it('returns Grow errors verbatim without classifying them (documented token error example)', async () => {
    fetchMock.mockResolvedValue(growResponse({ err: { id: 103, message: 'כרטיס גנוב - עסקה לא מאושרת' }, status: 0, data: '' }))
    expect(await chargeToken(input)).toEqual({ kind: 'grow_error', errorId: 103, errorMessage: 'כרטיס גנוב - עסקה לא מאושרת' })
  })

  it.each([
    ['timeout', () => fetchMock.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' })), 'timeout'],
    ['connection reset', () => fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })), 'network'],
    ['gateway error', () => fetchMock.mockResolvedValue(new Response('upstream timed out', { status: 504 })), 'http_status'],
    ['redirect', () => fetchMock.mockResolvedValue(new Response(null, { status: 308, headers: { location: 'https://x.example/' } })), 'redirect'],
    ['non-envelope body', () => fetchMock.mockResolvedValue(growResponse({ message: 'Internal error' })), 'invalid_envelope'],
  ])('%s: throws GrowTransportError (outcome unknown) after exactly one request, never retried', async (_label, arrange, reason) => {
    arrange()
    const err = await chargeToken({ ...input, cardToken: 'TOKEN-VALUE-MUST-NOT-LEAK' }).catch((e) => e)
    expect(err).toBeInstanceOf(GrowTransportError)
    expect(err.reason).toBe(reason)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(`${err.message} ${JSON.stringify(err)}`).not.toMatch(/TOKEN-VALUE|user-1|page-1/)
  })
})

describe('lookupTokenTransactionsRaw (response undocumented)', () => {
  it('sends the documented request fields and returns the envelope uninterpreted', async () => {
    const body = { status: 1, err: '', data: { anything: ['as', 'grow', 'sent', 'it'] } }
    fetchMock.mockResolvedValue(growResponse(body))
    expect(await lookupTokenTransactionsRaw({ cardToken: 'ct', identifier: { uniqueIdentifier: 5 } })).toEqual({ status: 1, err: null, data: body.data })
    const { url, form } = sent()
    expect(url.endsWith('/getTokenTransactionsByExternalIdentifiers/')).toBe(true)
    expect(form.get('userId')).toBe('user-1')
    expect(form.get('cardToken')).toBe('ct')
    expect(form.get('transactionUniqueIdentifier')).toBe('5')
  })
})
