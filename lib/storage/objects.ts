import 'server-only'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { readR2Config, StorageConfigError, type R2Config } from './config'
import { logStorageEvent } from './events'

/**
 * THE storage adapter, and the only module that talks to R2.
 *
 * AWS SDK v3 is used purely as an S3 protocol client: the endpoint is always R2,
 * and credentials are always passed explicitly, so the SDK's AWS credential chain
 * is never consulted.
 *
 * SIGNING IS NOT AUTHORIZING. A presigned URL proves only that this server issued
 * it. Callers must finish tenant and lead checks first, and nothing here knows who
 * is asking.
 */

export class StorageNotFoundError extends Error {
  constructor() {
    super('storage.not_found')
    this.name = 'StorageNotFoundError'
  }
}

export class StorageUnavailableError extends Error {
  readonly code: string | null
  readonly httpStatus: number | null
  constructor(code: string | null, httpStatus: number | null) {
    super(`storage.unavailable:${code ?? 'unknown'}`)
    this.name = 'StorageUnavailableError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export type HeadResult = {
  size: number
  contentType: string | null
  etag: string | null
  metadata: Record<string, string>
}

/**
 * WHEN_REQUIRED matters: with SDK 3.948's defaults a presigned PUT carries the
 * CRC32 of an EMPTY body (`x-amz-checksum-crc32=AAAAAA==`), which S3-compatible
 * stores can reject against the real upload.
 */
export function buildR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    // <account>.r2.cloudflarestorage.com/<bucket>/<key>, the form Cloudflare documents
    // for presigned URLs, instead of the SDK choosing a host by the bucket's name.
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

let cached: { fingerprint: string; client: S3Client; bucket: string } | null = null

function r2(): { client: S3Client; bucket: string } {
  let config: R2Config
  try {
    config = readR2Config()
  } catch (err) {
    if (err instanceof StorageConfigError) logStorageEvent('config.missing', { reason: err.message })
    throw err
  }
  // Rebuilt if the configuration changes. Holds only the access key ID, never the secret.
  const fingerprint = `${config.endpoint}|${config.bucket}|${config.accessKeyId}`
  if (cached?.fingerprint !== fingerprint) {
    cached = { fingerprint, client: buildR2Client(config), bucket: config.bucket }
  }
  return cached
}

function failure(err: unknown, operation: string): Error {
  if (err instanceof StorageConfigError) return err
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
  const httpStatus = e?.$metadata?.httpStatusCode ?? null
  const code = e?.name ?? e?.Code ?? null
  if (code === 'NotFound' || code === 'NoSuchKey' || httpStatus === 404) return new StorageNotFoundError()
  logStorageEvent('r2.error', { operation, code, httpStatus })
  return new StorageUnavailableError(code, httpStatus)
}

/**
 * A browser upload URL. Content-Type is signed alongside Content-Length, so a client
 * cannot swap a declared PDF for an HTML page or exceed the validated size.
 */
export async function presignUpload(input: {
  key: string
  contentType: string
  contentLength: number
  expiresInSeconds?: number
}): Promise<string> {
  const { client, bucket } = r2()
  try {
    return await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      }),
      { expiresIn: input.expiresInSeconds ?? 60, signableHeaders: new Set(['content-type', 'content-length']) },
    )
  } catch (err) {
    throw failure(err, 'presign_put')
  }
}

/** A short-lived read URL. The response headers are forced, whatever the object claims. */
export async function presignDownload(input: {
  key: string
  contentDisposition: string
  contentType: string
  expiresInSeconds?: number
}): Promise<string> {
  const { client, bucket } = r2()
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: input.key,
        ResponseContentDisposition: input.contentDisposition,
        ResponseContentType: input.contentType,
      }),
      { expiresIn: input.expiresInSeconds ?? 60 },
    )
  } catch (err) {
    throw failure(err, 'presign_get')
  }
}

/** Throws StorageNotFoundError for a missing object. */
export async function headObject(key: string): Promise<HeadResult> {
  const { client, bucket } = r2()
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return {
      size: Number(head.ContentLength ?? 0),
      contentType: head.ContentType ?? null,
      etag: head.ETag ? head.ETag.replace(/^"|"$/g, '') : null,
      metadata: head.Metadata ?? {},
    }
  } catch (err) {
    throw failure(err, 'head')
  }
}

export async function putObject(input: {
  key: string
  body: Uint8Array
  contentType: string
  metadata?: Record<string, string>
}): Promise<void> {
  const { client, bucket } = r2()
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.body.byteLength,
        Metadata: input.metadata,
      }),
    )
  } catch (err) {
    throw failure(err, 'put')
  }
}

/** Server-side read, for example to attach an invoice to an email. */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const { client, bucket } = r2()
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!res.Body) throw new StorageNotFoundError()
    return await res.Body.transformToByteArray()
  } catch (err) {
    if (err instanceof StorageNotFoundError) throw err
    throw failure(err, 'get')
  }
}

/** One page of a listing, for the read-only orphan report. */
export async function listObjects(input: { prefix: string; cursor?: string }) {
  const { client, bucket } = r2()
  try {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: input.prefix, ContinuationToken: input.cursor }))
    return {
      objects: (res.Contents ?? []).map((o) => ({ key: o.Key ?? '', size: Number(o.Size ?? 0), lastModified: o.LastModified ?? new Date(0) })),
      nextCursor: res.IsTruncated ? res.NextContinuationToken : undefined,
    }
  } catch (err) {
    throw failure(err, 'list')
  }
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = r2()
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  } catch (err) {
    throw failure(err, 'delete')
  }
}
