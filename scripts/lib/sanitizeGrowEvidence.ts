/**
 * Makes a Grow response safe to print or save as Gate B evidence.
 *
 * ALLOWLIST, not denylist: some responses (getTokenTransactionsByExternalIdentifiers)
 * are undocumented, so no list of "sensitive" keys can be complete. Every key
 * NAME is kept — the shape is the evidence — but a value is shown only when its
 * key is one Gate B needs and cannot identify, contact or charge anyone. Card
 * digits keep only their shape ("NNNN"). Known secret values (Grow userId,
 * pageCode, stored tokens) are then removed from whatever text remains.
 */

const VERBATIM_KEYS = new Set([
  'status',
  'statusCode',
  'err',
  'id',
  'message',
  'errorId',
  'errorMessage',
  'kind',
  'sum',
  'processId',
  'transactionId',
  'asmachta',
  'cardBrand',
  'cardType',
  'paymentType',
  'paymentsNum',
  'paymentDate',
  'description',
  'cField1',
  'transactionUniqueIdentifier',
  'transactionGroupIdentifier',
  'nonJsonBody',
])
const SHAPE_ONLY_KEYS = new Set(['cardExp', 'cardSuffix'])

function mask(value: unknown): string {
  return `<redacted len ${String(value).length}>`
}

export function redactKnownSecrets(text: string, secrets: readonly string[]): string {
  return [...secrets]
    .filter((v) => v.length >= 4)
    .sort((a, b) => b.length - a.length)
    .reduce((out, secret) => out.split(secret).join('<redacted secret>'), text)
}

function sanitizeValue(key: string, value: unknown, secrets: readonly string[]): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'object') return sanitizeGrowEvidence(value, secrets)
  if (SHAPE_ONLY_KEYS.has(key)) return String(value).replace(/\d/g, 'N')
  if (!VERBATIM_KEYS.has(key)) return mask(value)
  return typeof value === 'string' ? redactKnownSecrets(value, secrets) : value
}

export function sanitizeGrowEvidence(value: unknown, secrets: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((v) => sanitizeValue('', v, secrets))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(k, v, secrets)]))
  }
  return value === null || value === undefined ? value : mask(value)
}
