import { randomUUID } from 'node:crypto'
import { extensionFor } from './policy'

/**
 * Object keys. The server chooses every key.
 *
 * `tenants/<agencyId>/...` makes ownership checkable from the key alone, and a
 * random UUID makes a key unguessable. The original filename is never part of a
 * key: it is customer text, and it lives on the `files` row.
 *
 * Anything without this prefix predates R2 and has no object in the bucket.
 */

const PREFIX = 'tenants'

export function uploadKey(agencyId: number, type: string): string {
  return `${PREFIX}/${agencyId}/uploads/${randomUUID()}.${extensionFor(type)}`
}

export function invoicePdfKey(agencyId: number, invoiceId: number): string {
  return `${PREFIX}/${agencyId}/invoices/${invoiceId}/${randomUUID()}.pdf`
}

export function quotePdfKey(agencyId: number, quoteId: number): string {
  return `${PREFIX}/${agencyId}/quotes/${quoteId}/${randomUUID()}.pdf`
}

export function isStorageKey(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith(`${PREFIX}/`)
}

/**
 * An upload key this agency itself was issued. The browser hands a key back when
 * it registers a file, so this is what stops one tenant registering another
 * tenant's object as its own. `..` is refused outright.
 */
export function isOwnUploadKey(path: unknown, agencyId: number): path is string {
  return typeof path === 'string' && path.startsWith(`${PREFIX}/${agencyId}/uploads/`) && !path.includes('..')
}
