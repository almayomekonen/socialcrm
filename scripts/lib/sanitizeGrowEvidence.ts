/**
 * Makes a Grow response safe to print or save as Gate B evidence.
 *
 * Kept verbatim: status/statusCode/sum/ids and every key NAME — the shape is the
 * evidence. Masked: anything that can charge, identify or contact a person
 * (tokens, names, phones, emails, bank details) and the hosted page url (it may
 * embed a process token). Card digits keep only their shape ("NNNN"), which is
 * what the cardExp-format question needs.
 */

const MASK_KEY = /token|phone|email|fullname|name$|bank|account|^url$/i
const SHAPE_ONLY_KEY = /^(cardExp|cardSuffix)$/

function mask(value: unknown): string {
  return `<redacted len ${String(value ?? '').length}>`
}

export function sanitizeGrowEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => sanitizeGrowEvidence(v))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v && typeof v === 'object') out[k] = MASK_KEY.test(k) ? mask(JSON.stringify(v)) : sanitizeGrowEvidence(v)
      else if (SHAPE_ONLY_KEY.test(k)) out[k] = String(v ?? '').replace(/\d/g, 'N')
      else if (MASK_KEY.test(k)) out[k] = mask(v)
      else out[k] = v
    }
    return out
  }
  return value
}
