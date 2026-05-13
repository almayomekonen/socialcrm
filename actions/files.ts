'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { s3 } from '@/config/s3'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { revalidatePath } from 'next/cache'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { genId } from '@/lib/funcs'
import { getAgencyId } from '@/db/agencies'
import { daysFromNow } from '@/lib/dates'
import { requireUser } from '@/lib/requireUser'

const Bucket = process.env.S3_BUCKET_NAME

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpg',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

function trunc(s: unknown, n = 200): string {
  const v = typeof s === 'string' ? s : String(s ?? '')
  return v.length > n ? v.slice(0, n) + '…' : v
}

export async function getPresigned({ metadat, folderPath }: Props) {
  for (const m of metadat) {
    if (!ALLOWED_MIME_TYPES.includes(m.type)) {
      console.warn('[upload] presign.validation.fail', JSON.stringify({ reason: 'mime-not-allowed', mime: m.type, size: m.size }))
      throw new Error(`File type "${m.type}" is not allowed. Allowed types: PDF, PNG, JPG.`)
    }
    if (m.size > MAX_FILE_SIZE) {
      console.warn(
        '[upload] presign.validation.fail',
        JSON.stringify({ reason: 'size-too-large', size: m.size, max: MAX_FILE_SIZE }),
      )
      throw new Error(`File "${m.name}" exceeds the 10 MB size limit.`)
    }
  }

  try {
    return await Promise.all(
      metadat.map((m) => {
        const path = `uploads/${folderPath}/${genId()}_${m.name}`
        const cmd = new PutObjectCommand({ Bucket, Key: path, ContentType: m.type, ContentLength: m.size })
        return getSignedUrl(s3 as any, cmd as any, { expiresIn: 60 }).then((url) => ({ url, path, ...m }))
      }),
    )
  } catch (err) {
    // S3 SDK errors carry useful $metadata.httpStatusCode + name (e.g.
    // 'CredentialsProviderError', 'AccessDenied', 'NoSuchBucket').
    const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }
    console.error(
      '[upload] presign.s3.fail',
      JSON.stringify({
        count: metadat.length,
        name: e?.name ?? null,
        httpStatus: e?.$metadata?.httpStatusCode ?? null,
        message: trunc(e?.message),
      }),
    )
    throw err
  }
}

interface Props {
  metadat: { name: string; type: string; size: number }[]
  folderPath?: string
}

export async function addFilesToTask(data, clientId) {
  const fileCount = Array.isArray(data?.files) ? data.files.length : 0
  try {
    const user = await requireUser()
    const task = await db('tasks').where({ id: data.taskId }).select('clientId').first()
    if (!task) {
      console.warn('[upload] addFilesToTask.fail', JSON.stringify({ reason: 'task-not-found', taskId: data?.taskId, fileCount }))
      throw new Error('Forbidden')
    }
    const client = await db('clients').where({ id: task.clientId, agencyId: user.agencyId }).first()
    if (!client) {
      console.warn('[upload] addFilesToTask.fail', JSON.stringify({ reason: 'agency-mismatch', taskId: data?.taskId, fileCount }))
      throw new Error('Forbidden')
    }
    await db('tasks')
      .where({ id: data.taskId })
      .update({
        files: db.raw('COALESCE(files, ARRAY[]::integer[]) || ?', [data.files]),
      })

    revalidatePath(`/clients/${clientId}/files`)
  } catch (err) {
    const e = err as { message?: string }
    // Avoid double-logging Forbidden errors we already logged above.
    if (e?.message !== 'Forbidden') {
      console.error(
        '[upload] addFilesToTask.fail',
        JSON.stringify({ reason: 'throw', taskId: data?.taskId, fileCount, message: trunc(e?.message) }),
      )
    }
    throw err
  }
}

export async function getUserImgs(userId) {
  const user = await requireUser()
  const images = await db('files')
    .where({ createdById: userId, agencyId: user.agencyId, type: 'image/webp' })
    .orderBy('createdAt', 'desc')
  return images
}

export async function addFiles({ presigned, taskId = null, clientId }) {
  const count = Array.isArray(presigned) ? presigned.length : 0
  const user = await getUser()

  if (!user) {
    console.warn('[upload] addFiles.fail', JSON.stringify({ reason: 'no-user', count }))
    throw new Error('Forbidden')
  }

  try {
    presigned.map((p) => delete p.url)
    const agencyId = await getAgencyId()
    const files = presigned.map((p) => ({
      ...p,
      taskId,
      clientId,
      createdById: user.id,
      createdAt: new Date(),
      agencyId,
    }))

    const newFiles = await db('files').insert(files).returning('*')
    return newFiles
  } catch (err) {
    const e = err as { code?: string; message?: string }
    console.error('[upload] addFiles.db.fail', JSON.stringify({ count, code: e?.code ?? null, message: trunc(e?.message) }))
    throw err
  }
}

export async function deleteFile(file) {
  const user = await requireUser()
  const existing = await db('files').where({ id: file.id, agencyId: user.agencyId }).first()
  if (!existing) throw new Error('Forbidden')
  await db('files').where({ id: file.id }).delete()
  revalidatePath(`/clients/${file.clientId}/files`)
  revalidatePath(`/files`)
}

export async function addIpuyFile({ presigned, data, type }: { presigned: any; data: any; type: string }) {
  const count = Array.isArray(presigned) ? presigned.length : 0
  try {
    const user = await requireUser()
    const client = await db('clients').where({ id: data.clientId, agencyId: user.agencyId }).first()
    if (!client) {
      console.warn(
        '[upload] addIpuyFile.fail',
        JSON.stringify({ reason: 'client-not-found-or-agency-mismatch', clientId: data?.clientId, type, count }),
      )
      throw new Error('Forbidden')
    }
    presigned.map((p) => delete p.url)
    const files = presigned.map((p) => ({
      ...p,
      clientId: data.clientId,
      createdById: user.id,
      createdAt: new Date(),
      agencyId: user.agencyId,
    }))

    const newFiles = await db('files').insert(files).returning('*')

    const expiresAt = {
      reports: daysFromNow(90),
      documents: daysFromNow(5),
      files: daysFromNow(30),
    }

    await db('clients_info')
      .where({ id: data.clientId })
      .update({
        ipuyFiles: db.raw(`jsonb_set(COALESCE("ipuyFiles", '{}'::jsonb), ?, ?::jsonb)`, [
          `{${type}}`,
          JSON.stringify({
            url: newFiles[0].url,
            expiresAt: expiresAt[type],
          }),
        ]),
      })
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (e?.message !== 'Forbidden') {
      console.error(
        '[upload] addIpuyFile.fail',
        JSON.stringify({
          reason: 'throw',
          clientId: data?.clientId,
          type,
          count,
          code: e?.code ?? null,
          message: trunc(e?.message),
        }),
      )
    }
    throw err
  }
}
