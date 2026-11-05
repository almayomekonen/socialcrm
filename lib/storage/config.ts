/**
 * Cloudflare R2 configuration. Pure: no SDK, no I/O.
 *
 * STRICT, WITH NO FALLBACK. A missing variable throws, naming the variable and
 * never a value. Nothing here reads AWS_* or S3_*: storage cannot silently land
 * on AWS, because this is the only place a bucket or a credential is read.
 */

export const REQUIRED_R2_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'] as const

export class StorageConfigError extends Error {
  readonly missing: readonly string[]
  constructor(missing: readonly string[], reason = 'missing') {
    super(`storage.config_${reason}:${missing.join(',')}`)
    this.name = 'StorageConfigError'
    this.missing = missing
  }
}

export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  endpoint: string
}

type Env = Record<string, string | undefined>

const ACCOUNT_ID = /^[a-f0-9]{32}$/i

export function readR2Config(env: Env = process.env): R2Config {
  const value = (name: string) => env[name]?.trim() ?? ''
  const missing = REQUIRED_R2_ENV.filter((name) => !value(name))
  if (missing.length) throw new StorageConfigError(missing)

  const accountId = value('R2_ACCOUNT_ID')
  if (!ACCOUNT_ID.test(accountId)) throw new StorageConfigError(['R2_ACCOUNT_ID'], 'invalid')

  return {
    accountId,
    accessKeyId: value('R2_ACCESS_KEY_ID'),
    secretAccessKey: value('R2_SECRET_ACCESS_KEY'),
    bucket: value('R2_BUCKET_NAME'),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  }
}

/**
 * The public asset domain, or null when none is configured.
 *
 * OPTIONAL, unlike everything above: R2 public access is per BUCKET, so this must
 * belong to a separate, public-only bucket and never to R2_BUCKET_NAME, which
 * stays private. No application file is public today; see `publicAssetUrl`.
 *
 * A set value is still validated, so a typo fails instead of producing a bad link.
 * `r2.dev` is refused because Cloudflare documents it as non-production, and AWS
 * hosts are refused so a stale value cannot bring a bucket URL back.
 */
export function readPublicBaseUrl(env: Env = process.env): string | null {
  const raw = env.R2_PUBLIC_BASE_URL?.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new StorageConfigError(['R2_PUBLIC_BASE_URL'], 'invalid')
  }
  const host = url.hostname.toLowerCase()
  const refused = host.endsWith('.r2.dev') || host.endsWith('amazonaws.com') || host.endsWith('r2.cloudflarestorage.com')
  if (url.protocol !== 'https:' || refused) throw new StorageConfigError(['R2_PUBLIC_BASE_URL'], 'invalid')
  return raw.replace(/\/+$/, '')
}
