import { readPublicBaseUrl, StorageConfigError } from './config'

/**
 * The URL of a deliberately public asset, from the separate public bucket.
 *
 * NOTHING CALLS THIS YET, on purpose: every application file is private and goes
 * through /api/files/[fileId]. It exists so that an asset which truly must be
 * public (a logo in a customer email, say) has one explicit route, and so that
 * only keys under `public/` can ever produce a public link.
 */
export function publicAssetUrl(key: string): string {
  if (!key.startsWith('public/') || key.includes('..')) throw new Error('storage.not_a_public_asset')
  const base = readPublicBaseUrl()
  if (!base) throw new StorageConfigError(['R2_PUBLIC_BASE_URL'])
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
}
