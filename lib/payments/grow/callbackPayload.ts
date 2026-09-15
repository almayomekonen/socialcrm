/**
 * Reads Grow's server-to-server callback (notifyUrl) for a token-save process.
 *
 * DOCUMENTED CONTRACT. Grow posts the update "as an HTTP POST, the same way as
 * you would send the data to the CreatePaymentProcess method and NOT as JSON"
 * (server-response, token-server-response). CreatePaymentProcess is
 * multipart/form-data; standard form posts may equally arrive urlencoded. Both
 * are accepted deliberately. JSON is refused.
 *
 * KEY SHAPE IS NOT OBSERVED YET (Gate B, B3). The documented example is the
 * nested envelope { err, status, data: { …, customFields: { cField1 } } }.
 * Sent as a form, that is either flat keys (`processId`, `cField1`, like the
 * CreatePaymentProcess request) or bracketed keys (`data[processId]`,
 * `data[customFields][cField1]`). Both shapes map to one field; if they disagree,
 * or one key repeats with different values, the body is refused rather than
 * guessed. The envelope `status` is never read: in the flat shape it collides
 * with the transaction's Hebrew status text.
 *
 * The callback is only a trigger: confirmCardSetup authenticates it and
 * verifies every fact with Grow before anything changes.
 */

export type GrowCallback = {
  processId: string | null
  processToken: string | null
  transactionId: string | null
  transactionToken: string | null
  statusCode: string | null
  sum: string | null
  cardToken: string | null
  cardSuffix: string | null
  cardBrand: string | null
  cardExp: string | null
  /** cField1 — the reference we sent to createPaymentProcess. */
  reference: string | null
}

export type CallbackEncoding = 'urlencoded' | 'multipart'
export type CallbackRefusal = 'unsupported_encoding' | 'too_large' | 'unparseable' | 'ambiguous_field' | 'conflicting_field'

export class GrowCallbackError extends Error {
  constructor(
    public reason: CallbackRefusal,
    public field: string | null = null,
  ) {
    super(`grow.callback.${reason}${field ? `:${field}` : ''}`)
    this.name = 'GrowCallbackError'
  }
}

export const MAX_CALLBACK_BYTES = 64 * 1024

const flatOrData = (name: string) => [name, `data[${name}]`] as const

const FIELD_ALIASES: Record<keyof GrowCallback, readonly string[]> = {
  processId: flatOrData('processId'),
  processToken: flatOrData('processToken'),
  transactionId: flatOrData('transactionId'),
  transactionToken: flatOrData('transactionToken'),
  statusCode: flatOrData('statusCode'),
  sum: flatOrData('sum'),
  cardToken: flatOrData('cardToken'),
  cardSuffix: flatOrData('cardSuffix'),
  cardBrand: flatOrData('cardBrand'),
  cardExp: flatOrData('cardExp'),
  reference: ['cField1', 'customFields[cField1]', 'data[cField1]', 'data[customFields][cField1]'],
}

function encodingOf(contentType: string): CallbackEncoding {
  const ct = contentType.toLowerCase()
  if (ct.startsWith('application/x-www-form-urlencoded')) return 'urlencoded'
  if (ct.startsWith('multipart/form-data')) return 'multipart'
  throw new GrowCallbackError('unsupported_encoding')
}

async function readEntries(req: Request, encoding: CallbackEncoding, contentType: string): Promise<[string, string][]> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_CALLBACK_BYTES) throw new GrowCallbackError('too_large')
  const body = await req.arrayBuffer().catch(() => {
    throw new GrowCallbackError('unparseable')
  })
  if (body.byteLength > MAX_CALLBACK_BYTES) throw new GrowCallbackError('too_large')

  if (encoding === 'urlencoded') return [...new URLSearchParams(new TextDecoder().decode(body)).entries()]

  const form = await new Response(body, { headers: { 'content-type': contentType } }).formData().catch(() => {
    throw new GrowCallbackError('unparseable')
  })
  const entries: [string, string][] = []
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') throw new GrowCallbackError('unparseable', key)
    entries.push([key, value])
  }
  return entries
}

/** Pure: form entries → one value per field, refusing ambiguity. */
export function pickCallbackFields(entries: [string, string][]): GrowCallback {
  const byKey = new Map<string, string[]>()
  for (const [key, raw] of entries) {
    const value = raw.trim()
    if (!value) continue
    byKey.set(key, [...(byKey.get(key) ?? []), value])
  }

  const pick = (field: keyof GrowCallback): string | null => {
    const found = new Set<string>()
    for (const alias of FIELD_ALIASES[field]) {
      const values = new Set(byKey.get(alias) ?? [])
      if (values.size > 1) throw new GrowCallbackError('ambiguous_field', alias)
      for (const v of values) found.add(v)
    }
    if (found.size > 1) throw new GrowCallbackError('conflicting_field', field)
    return found.size ? [...found][0] : null
  }

  const out = {} as GrowCallback
  for (const field of Object.keys(FIELD_ALIASES) as (keyof GrowCallback)[]) out[field] = pick(field)
  return out
}

export async function readGrowCallback(req: Request): Promise<{ callback: GrowCallback; encoding: CallbackEncoding; keys: string[] }> {
  const contentType = req.headers.get('content-type') ?? ''
  const encoding = encodingOf(contentType)
  const entries = await readEntries(req, encoding, contentType)
  const keys = [...new Set(entries.map(([k]) => k))].sort().slice(0, 100)
  return { callback: pickCallbackFields(entries), encoding, keys }
}
