import { describe, it, expect } from 'vitest'
import { readGrowCallback, pickCallbackFields, GrowCallbackError, MAX_CALLBACK_BYTES } from '@/lib/payments/grow/callbackPayload'

/**
 * Values below are copied from Grow's documented token-server-response example.
 * The two key SHAPES are derived from the documentation; neither is an observed
 * Grow callback (Gate B, B3).
 */
const DOC = {
  status: 'עסקה מושהית',
  statusCode: '11',
  sum: '1',
  cardSuffix: '1234',
  cardBrand: 'Visa',
  cardExp: '1125',
  cardToken: '9294decf1dg5g2g5g2g5g2g58fd286',
  transactionId: '287377',
  transactionToken: '4e6ca0b42e5ca8f35563cg2g517ed5e',
  processId: '462950',
  processToken: 'e2202e3c9ffaaf65de1g2g53fbad5e9d',
  fullName: 'בדיקה GROW',
  payerPhone: '0500000000',
}
const EXPECTED = {
  processId: '462950',
  processToken: 'e2202e3c9ffaaf65de1g2g53fbad5e9d',
  transactionId: '287377',
  transactionToken: '4e6ca0b42e5ca8f35563cg2g517ed5e',
  statusCode: '11',
  sum: '1',
  cardToken: '9294decf1dg5g2g5g2g5g2g58fd286',
  cardSuffix: '1234',
  cardBrand: 'Visa',
  cardExp: '1125',
  reference: 'ref-abc',
}

const post = (body: BodyInit, contentType?: string) =>
  new Request('https://app.example.com/api/payments/grow/notify', {
    method: 'POST',
    body,
    headers: contentType ? { 'content-type': contentType } : undefined,
  })

async function refusal(req: Request): Promise<string> {
  try {
    await readGrowCallback(req)
  } catch (err) {
    expect(err).toBeInstanceOf(GrowCallbackError)
    return (err as GrowCallbackError).reason
  }
  throw new Error('expected a refusal')
}

describe('readGrowCallback — documented encodings', () => {
  it('reads flat urlencoded fields, including Hebrew values', async () => {
    const body = new URLSearchParams({ ...DOC, cField1: 'ref-abc' })
    const out = await readGrowCallback(post(body.toString(), 'application/x-www-form-urlencoded; charset=UTF-8'))
    expect(out.encoding).toBe('urlencoded')
    expect(out.callback).toEqual(EXPECTED)
    expect(out.keys).toContain('cardToken')
  })

  it('reads data[...] multipart fields with nested custom fields', async () => {
    const form = new FormData()
    form.append('err', '')
    form.append('status', '1')
    for (const [k, v] of Object.entries(DOC)) form.append(`data[${k}]`, v)
    form.append('data[customFields][cField1]', 'ref-abc')
    const out = await readGrowCallback(post(form))
    expect(out.encoding).toBe('multipart')
    expect(out.callback).toEqual(EXPECTED)
  })

  it('treats empty values as absent (Grow sends "" for empty fields)', () => {
    expect(pickCallbackFields([['processId', ''], ['data[processId]', '462950'], ['cardToken', '  ']])).toMatchObject({ processId: '462950', cardToken: null })
  })

  it('accepts the same value under both shapes', () => {
    expect(pickCallbackFields([['processId', '462950'], ['data[processId]', '462950']]).processId).toBe('462950')
  })
})

describe('readGrowCallback — refusals', () => {
  it('refuses JSON: Grow posts "NOT as JSON"', async () => {
    expect(await refusal(post(JSON.stringify({ data: DOC }), 'application/json'))).toBe('unsupported_encoding')
  })

  it('refuses a missing content type', async () => {
    expect(await refusal(post('processId=1'))).toBe('unsupported_encoding')
  })

  it('refuses conflicting values between the flat and data[...] shapes', async () => {
    const body = new URLSearchParams([['processId', '462950'], ['data[processId]', '999999']])
    expect(await refusal(post(body.toString(), 'application/x-www-form-urlencoded'))).toBe('conflicting_field')
  })

  it('refuses a key repeated with different values', async () => {
    const body = new URLSearchParams([['cardToken', 'a'], ['cardToken', 'b']])
    expect(await refusal(post(body.toString(), 'application/x-www-form-urlencoded'))).toBe('ambiguous_field')
  })

  it('refuses conflicting references across cField1 spellings', () => {
    expect(() => pickCallbackFields([['cField1', 'a'], ['data[customFields][cField1]', 'b']])).toThrow(GrowCallbackError)
  })

  it('refuses an oversized body', async () => {
    const body = `processId=1&pad=${'x'.repeat(MAX_CALLBACK_BYTES)}`
    expect(await refusal(post(body, 'application/x-www-form-urlencoded'))).toBe('too_large')
  })

  it('refuses a file part', async () => {
    const form = new FormData()
    form.append('processId', new Blob(['462950']), 'x.txt')
    expect(await refusal(post(form))).toBe('unparseable')
  })

  it('never puts a field value in the error message', async () => {
    const body = new URLSearchParams([['processToken', 'secret-one'], ['data[processToken]', 'secret-two']])
    try {
      await readGrowCallback(post(body.toString(), 'application/x-www-form-urlencoded'))
    } catch (err) {
      expect(String((err as Error).message)).not.toMatch(/secret-/)
    }
  })
})
