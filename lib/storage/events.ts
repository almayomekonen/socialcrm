/**
 * Structured storage and PDF events, drained to Axiom through the Vercel logs.
 *
 * THE FIELDS ARE A CLOSED LIST, and that is the safety property. There is no field
 * for a URL, an object key, a filename, a recipient or a body, so a signed query
 * string or customer data cannot be passed here without changing this type.
 */

export type StorageEvent =
  | 'upload.presigned'
  | 'upload.refused'
  | 'upload.completed'
  | 'upload.failed'
  | 'download.authorized'
  | 'download.denied'
  | 'download.legacy_file'
  | 'download.missing_object'
  | 'object.deleted'
  | 'object.delete_failed'
  | 'r2.error'
  | 'config.missing'
  | 'pdf.render.succeeded'
  | 'pdf.render.failed'
  | 'pdf.render.timeout'
  | 'pdf.upload.completed'
  | 'pdf.upload.failed'
  | 'pdf.stale_render_closed'

export type StorageEventFields = {
  agencyId?: number | null
  userId?: number | null
  fileId?: number | null
  invoiceId?: number | null
  documentId?: number | null
  count?: number
  size?: number | null
  mime?: string | null
  operation?: string
  renderer?: string
  /** A fixed code, never free text from a request or a provider. */
  reason?: string
  /** The SDK or provider error's NAME or code. */
  code?: string | null
  httpStatus?: number | null
  latencyMs?: number
}

const FAILURES = new Set<StorageEvent>([
  'upload.failed',
  'object.delete_failed',
  'r2.error',
  'config.missing',
  'pdf.render.failed',
  'pdf.render.timeout',
  'pdf.upload.failed',
])

const FIELDS = new Set<string>(['agencyId', 'userId', 'fileId', 'invoiceId', 'documentId', 'count', 'size', 'mime', 'operation', 'renderer', 'reason', 'code', 'httpStatus', 'latencyMs'])

/** Text that could only be a URL, a signature or an address has no place in a code. */
const UNSAFE = /:\/\/|x-amz-|signature=|@/i

/**
 * Enforced at runtime too: this module is called from JavaScript-shaped paths (`err as
 * ...`), where the type above proves nothing. An unknown field is dropped, and a value
 * that looks like a URL or an address is replaced.
 */
function safeFields(fields: StorageEventFields): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!FIELDS.has(key)) continue
    out[key] = typeof value === 'string' ? (UNSAFE.test(value) ? '[redacted]' : value.slice(0, 120)) : value
  }
  return out
}

export function logStorageEvent(event: StorageEvent, fields: StorageEventFields = {}): void {
  const line = JSON.stringify({ event, ...safeFields(fields) })
  if (FAILURES.has(event)) console.error(`[storage] ${event}`, line)
  else console.log(`[storage] ${event}`, line)
}
