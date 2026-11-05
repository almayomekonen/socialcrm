import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Client } from '@aws-sdk/client-s3'
import { readPublicBaseUrl, readR2Config, StorageConfigError } from '@/lib/storage/config'
import { contentDisposition } from '@/lib/storage/disposition'
import { invoicePdfKey, isOwnUploadKey, isStorageKey, uploadKey } from '@/lib/storage/keys'
import { buildR2Client, deleteObject, getObjectBytes, headObject, presignDownload, presignUpload, putObject, StorageNotFoundError, StorageUnavailableError } from '@/lib/storage/objects'
import { checkUpload, MAX_UPLOAD_BYTES, servingOf } from '@/lib/storage/policy'
import { publicAssetUrl } from '@/lib/storage/publicAssets'
import { logStorageEvent } from '@/lib/storage/events'
import { findOrphans } from '@/lib/storage/orphans'
import { readFileSync } from 'node:fs'

/**
 * The R2 adapter, with no network: presigning is a local calculation, and every
 * network call is faked at S3Client.send. The credentials are obviously fake.
 */

const ACCOUNT = 'a'.repeat(32)
const ENV = { R2_ACCOUNT_ID: ACCOUNT, R2_ACCESS_KEY_ID: 'FAKEKEYID', R2_SECRET_ACCESS_KEY: 'fake-secret-value', R2_BUCKET_NAME: 'test-bucket' }

let logged: string[] = []
beforeEach(() => {
  vi.unstubAllEnvs()
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v)
  logged = []
  const capture = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
  vi.spyOn(console, 'log').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('configuration', () => {
  it('derives the R2 endpoint from the account id', () => {
    expect(readR2Config(ENV).endpoint).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com`)
    expect(readR2Config(ENV).bucket).toBe('test-bucket')
  })

  it.each(Object.keys(ENV))('names %s when it is missing, and never prints a value', (name) => {
    const env = { ...ENV, [name]: '' }
    const err = (() => {
      try {
        readR2Config(env)
      } catch (e) {
        return e as StorageConfigError
      }
    })()
    expect(err).toBeInstanceOf(StorageConfigError)
    expect(err!.missing).toEqual([name])
    expect(err!.message).not.toContain('fake-secret-value')
  })

  it('has no AWS fallback: AWS variables alone are a missing configuration', () => {
    const aws = { AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'y', AWS_DEFAULT_REGION: 'eu-north-1', S3_BUCKET_NAME: 'old' }
    expect(() => readR2Config(aws)).toThrow(StorageConfigError)
  })

  it('refuses a malformed account id rather than building a bad endpoint', () => {
    expect(() => readR2Config({ ...ENV, R2_ACCOUNT_ID: 'evil.example.com/' })).toThrow(StorageConfigError)
  })

  it('every operation fails with the configuration error, and reports it', async () => {
    vi.stubEnv('R2_BUCKET_NAME', '')
    await expect(headObject('k')).rejects.toBeInstanceOf(StorageConfigError)
    await expect(presignUpload({ key: 'k', contentType: 'application/pdf', contentLength: 1 })).rejects.toBeInstanceOf(StorageConfigError)
    expect(logged.some((l) => l.includes('config.missing') && l.includes('R2_BUCKET_NAME'))).toBe(true)
  })

  it('uses region auto, and the R2 checksum settings', async () => {
    const client = buildR2Client(readR2Config(ENV))
    expect(await client.config.region()).toBe('auto')
    expect(await client.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED')
    expect(await client.config.responseChecksumValidation()).toBe('WHEN_REQUIRED')
  })
})

describe('public asset base URL', () => {
  it('is optional, and validated when set', () => {
    expect(readPublicBaseUrl({})).toBeNull()
    expect(readPublicBaseUrl({ R2_PUBLIC_BASE_URL: 'https://assets.example.com/' })).toBe('https://assets.example.com')
  })

  it.each(['http://assets.example.com', 'https://x.r2.dev', 'https://b.s3.eu-north-1.amazonaws.com', 'https://a.r2.cloudflarestorage.com', 'not a url'])('refuses %s', (value) => {
    expect(() => readPublicBaseUrl({ R2_PUBLIC_BASE_URL: value })).toThrow(StorageConfigError)
  })

  it('only keys under public/ can ever produce a public link', () => {
    vi.stubEnv('R2_PUBLIC_BASE_URL', 'https://assets.example.com')
    expect(publicAssetUrl('public/logo.png')).toBe('https://assets.example.com/public/logo.png')
    expect(() => publicAssetUrl('tenants/1/invoices/2/x.pdf')).toThrow('not_a_public_asset')
    expect(() => publicAssetUrl('public/../tenants/1/x.pdf')).toThrow('not_a_public_asset')
  })

  it('fails clearly when asked for a public link with none configured', () => {
    vi.stubEnv('R2_PUBLIC_BASE_URL', '')
    expect(() => publicAssetUrl('public/logo.png')).toThrow(StorageConfigError)
  })
})

describe('presigned PUT', () => {
  const put = () => presignUpload({ key: 'tenants/1/uploads/x.pdf', contentType: 'application/pdf', contentLength: 1234 })

  it('targets R2, for this bucket and key, briefly', async () => {
    const url = new URL(await put())
    expect(url.host).toBe(`${ACCOUNT}.r2.cloudflarestorage.com`)
    expect(url.pathname).toBe('/test-bucket/tenants/1/uploads/x.pdf')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60')
    expect(url.href).not.toContain('amazonaws')
  })

  it('signs both content type and length, so neither can be swapped', async () => {
    const signed = new URL(await put()).searchParams.get('X-Amz-SignedHeaders')!.split(';')
    expect(signed).toEqual(expect.arrayContaining(['content-length', 'content-type', 'host']))
  })

  it('carries no empty-body checksum, the known presigned-PUT failure', async () => {
    const url = new URL(await put())
    expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false)
    expect(url.searchParams.has('x-amz-sdk-checksum-algorithm')).toBe(false)
  })

  it('never puts the secret in the URL', async () => {
    expect(await put()).not.toContain('fake-secret-value')
  })
})

describe('presigned GET', () => {
  it('forces the served type and disposition, with a Hebrew filename intact', async () => {
    const url = new URL(
      await presignDownload({ key: 'k.pdf', contentType: 'application/pdf', contentDisposition: contentDisposition('הצעה לדני.pdf') }),
    )
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf')
    const disposition = url.searchParams.get('response-content-disposition')!
    expect(disposition.startsWith('attachment;')).toBe(true)
    expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe('הצעה לדני.pdf')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60')
  })
})

describe('HEAD, GET, PUT and DELETE', () => {
  const send = () => vi.spyOn(S3Client.prototype, 'send')

  it('HEAD returns size, type, an unquoted ETag and metadata', async () => {
    send().mockResolvedValue({ ContentLength: 42, ContentType: 'application/pdf', ETag: '"abc"', Metadata: { sha256: 'h' } } as never)
    await expect(headObject('k')).resolves.toEqual({ size: 42, contentType: 'application/pdf', etag: 'abc', metadata: { sha256: 'h' } })
  })

  it.each([
    ['NotFound', 404],
    ['NoSuchKey', 404],
  ])('a missing object (%s) is a typed result, not an outage', async (name, status) => {
    send().mockRejectedValue(Object.assign(new Error('x'), { name, $metadata: { httpStatusCode: status } }))
    await expect(headObject('k')).rejects.toBeInstanceOf(StorageNotFoundError)
    expect(logged.some((l) => l.includes('r2.error'))).toBe(false)
  })

  it('anything else is an outage, logged by code only', async () => {
    const err = Object.assign(new Error('sensitive provider text k?X-Amz-Signature=abc'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
    send().mockRejectedValue(err)
    await expect(headObject('k')).rejects.toBeInstanceOf(StorageUnavailableError)
    const line = logged.find((l) => l.includes('r2.error'))!
    expect(line).toContain('AccessDenied')
    expect(line).toContain('403')
    expect(line).not.toContain('X-Amz-Signature')
    expect(line).not.toContain('sensitive')
  })

  it('an upload failure surfaces as an outage', async () => {
    send().mockRejectedValue(Object.assign(new Error('x'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } }))
    await expect(putObject({ key: 'k', body: new Uint8Array([1]), contentType: 'application/pdf' })).rejects.toBeInstanceOf(StorageUnavailableError)
  })

  it('PUT sends the exact bytes, type, length and metadata', async () => {
    const spy = send().mockResolvedValue({} as never)
    await putObject({ key: 'k', body: new Uint8Array([1, 2, 3]), contentType: 'application/pdf', metadata: { sha256: 'h' } })
    const input = (spy.mock.calls[0][0] as unknown as { input: Record<string, unknown> }).input
    expect(input).toMatchObject({ Bucket: 'test-bucket', Key: 'k', ContentType: 'application/pdf', ContentLength: 3, Metadata: { sha256: 'h' } })
  })

  it('GET returns the bytes, and a missing object stays typed', async () => {
    send().mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([7]) } } as never)
    await expect(getObjectBytes('k')).resolves.toEqual(new Uint8Array([7]))
    send().mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NoSuchKey' }))
    await expect(getObjectBytes('k')).rejects.toBeInstanceOf(StorageNotFoundError)
  })

  it('DELETE addresses the configured bucket', async () => {
    const spy = send().mockResolvedValue({} as never)
    await deleteObject('k')
    expect((spy.mock.calls[0][0] as unknown as { input: Record<string, unknown> }).input).toMatchObject({ Bucket: 'test-bucket', Key: 'k' })
  })
})

describe('object keys', () => {
  it('are tenant-scoped and random, and carry no customer text', () => {
    const a = uploadKey(7, 'application/pdf')
    expect(a).toMatch(/^tenants\/7\/uploads\/[0-9a-f-]{36}\.pdf$/)
    expect(a).not.toBe(uploadKey(7, 'application/pdf'))
    expect(invoicePdfKey(7, 9)).toMatch(/^tenants\/7\/invoices\/9\/[0-9a-f-]{36}\.pdf$/)
  })

  it('ownership cannot be claimed across tenants, by prefix tricks, or with a legacy path', () => {
    const k = uploadKey(7, 'image/png')
    expect(isOwnUploadKey(k, 7)).toBe(true)
    expect(isOwnUploadKey(k, 8)).toBe(false)
    expect(isOwnUploadKey(k, 70)).toBe(false)
    expect(isOwnUploadKey('tenants/7/uploads/../../8/uploads/x.pdf', 7)).toBe(false)
    expect(isOwnUploadKey('tenants/7/invoices/1/x.pdf', 7)).toBe(false)
    expect(isOwnUploadKey('uploads/7/docs/1_a.pdf', 7)).toBe(false)
    expect(isOwnUploadKey(null, 7)).toBe(false)
    expect(isStorageKey('uploads/7/docs/1_a.pdf')).toBe(false)
  })
})

describe('upload and serving policy', () => {
  const ok = { name: 'a.pdf', type: 'application/pdf', size: 10 }

  it.each(['text/html', 'image/svg+xml', 'application/javascript', '', 'constructor'])('refuses type %j', (type) => {
    expect(checkUpload({ ...ok, type })).toBe('mime_not_allowed')
  })

  it('enforces size in both directions', () => {
    expect(checkUpload({ ...ok, size: MAX_UPLOAD_BYTES })).toBeNull()
    expect(checkUpload({ ...ok, size: MAX_UPLOAD_BYTES + 1 })).toBe('too_large')
    expect(checkUpload({ ...ok, size: 0 })).toBe('size_invalid')
    expect(checkUpload({ ...ok, size: Number.NaN })).toBe('size_invalid')
  })

  it('serves known images and PDFs inline, spreadsheets as downloads, and anything else opaquely', () => {
    expect(servingOf('application/pdf')).toEqual({ contentType: 'application/pdf', inline: true })
    expect(servingOf('application/pdf', { download: true }).inline).toBe(false)
    expect(servingOf('application/vnd.ms-excel').inline).toBe(false)
    expect(servingOf('text/html')).toEqual({ contentType: 'application/octet-stream', inline: false })
  })
})

describe('events never carry a URL, a key, an address or an unknown field', () => {
  it('drops unknown fields and redacts unsafe text, at runtime', () => {
    logStorageEvent('r2.error', {
      code: 'https://a.r2.cloudflarestorage.com/b/k?X-Amz-Signature=abc',
      reason: 'customer@example.com',
      mime: 'application/pdf',
      url: 'https://leak.example/x',
      key: 'tenants/1/uploads/x.pdf',
      name: 'דוח סודי.pdf',
      body: 'content',
    } as never)
    const line = logged.join('\n')
    expect(line).toContain('application/pdf')
    expect(line).toContain('[redacted]')
    for (const secret of ['X-Amz-Signature', 'r2.cloudflarestorage', 'customer@example.com', 'leak.example', 'tenants/1', 'סודי', 'content']) {
      expect(line).not.toContain(secret)
    }
  })

  it('caps the length of a code', () => {
    logStorageEvent('r2.error', { code: 'x'.repeat(500) })
    expect(logged[0].length).toBeLessThan(250)
  })
})

describe('one upload limit', () => {
  it('is 10 MiB, and the copilot reads the same constant', async () => {
    const { COPILOT_MAX_FILE_BYTES } = await import('@/lib/copilot/attachments')
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024)
    expect(COPILOT_MAX_FILE_BYTES).toBe(MAX_UPLOAD_BYTES)
  })

  it('no uploader carries its own number', () => {
    for (const f of ['components/files/funcs.tsx', 'actions/files.ts', 'lib/copilot/uploadAttachments.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/10000000|1024 \* 1024/)
    }
  })
})

describe('the orphan report', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000)

  it('finds old objects with no row, and leaves referenced and in-progress ones alone', () => {
    const objects = [
      { key: 'old-unreferenced', size: 1, lastModified: at(48) },
      { key: 'old-referenced', size: 1, lastModified: at(48) },
      { key: 'just-uploaded', size: 1, lastModified: at(1) },
    ]
    expect(findOrphans(objects, new Set(['old-referenced']), now).map((o) => o.key)).toEqual(['old-unreferenced'])
  })

  it('the script can only report: it has no way to delete', () => {
    const source = readFileSync('scripts/r2-orphan-report.ts', 'utf8')
    expect(source).not.toMatch(/deleteObject|\.del\(|\.delete\(/)
    expect(source).toContain('listObjects')
  })
})

describe('Content-Disposition', () => {
  it('keeps Hebrew through RFC 5987 with an ASCII fallback', () => {
    const header = contentDisposition('חשבונית 42.pdf', 'inline')
    expect(header.startsWith('inline; filename="')).toBe(true)
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('חשבונית 42.pdf')}`)
    expect(/^[\x20-\x7E]+$/.test(header)).toBe(true)
  })

  it('cannot be broken out of by a filename', () => {
    const header = contentDisposition('a"\r\nX-Evil: 1/../b.pdf')
    expect(header).not.toMatch(/[\r\n]/)
    expect(header.split('filename="')[1].split('"')[0]).not.toContain('/')
  })
})
