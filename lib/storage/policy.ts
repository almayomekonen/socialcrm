/**
 * What may be uploaded, and how a stored file may be served. Pure, so the browser
 * and the server apply one definition.
 */

/** The one upload limit: every uploader and the server read this. 10 MiB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** The closed list, each with the extension its object key ends in. */
const UPLOAD_TYPES: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpg': 'jpg',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
}

export type UploadRefusal = 'mime_not_allowed' | 'size_invalid' | 'too_large' | 'name_missing'

export type UploadMeta = { name: string; type: string; size: number }

export function isAllowedUploadType(type: unknown): type is string {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(UPLOAD_TYPES, type)
}

export function extensionFor(type: string): string {
  return isAllowedUploadType(type) ? UPLOAD_TYPES[type] : 'bin'
}

export function checkUpload(meta: UploadMeta): UploadRefusal | null {
  if (!isAllowedUploadType(meta.type)) return 'mime_not_allowed'
  if (!Number.isSafeInteger(meta.size) || meta.size <= 0) return 'size_invalid'
  if (meta.size > MAX_UPLOAD_BYTES) return 'too_large'
  if (typeof meta.name !== 'string' || !meta.name.trim()) return 'name_missing'
  return null
}

/** The only types a browser may render in place. A spreadsheet always downloads. */
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpg', 'image/jpeg', 'image/webp'])

/**
 * The Content-Type and disposition to serve, from the type on OUR row. An unknown
 * stored type is forced to an opaque download, so nothing uploaded can ever run
 * as a page, whatever bytes it holds.
 */
export function servingOf(type: unknown, opts: { download?: boolean } = {}): { contentType: string; inline: boolean } {
  if (!isAllowedUploadType(type)) return { contentType: 'application/octet-stream', inline: false }
  return { contentType: type, inline: !opts.download && INLINE_TYPES.has(type) }
}
