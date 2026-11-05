'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { daysFromNow } from '@/lib/dates'
import { requireProductAccess } from '@/lib/requireUser'
import { logStorageEvent } from '@/lib/storage/events'
import { removeUnreferencedObjects } from '@/lib/storage/cleanup'
import { canDeleteFile, type FileRow } from '@/lib/storage/fileAccess'
import { isOwnUploadKey, uploadKey } from '@/lib/storage/keys'
import { deleteObject, headObject, presignUpload, StorageNotFoundError } from '@/lib/storage/objects'
import { checkUpload, isAllowedUploadType, MAX_UPLOAD_BYTES, type UploadMeta } from '@/lib/storage/policy'
import { canActOnLead, canActOnTask } from '@/lib/tasks/taskAccess'

/** The error's kind only. A message can carry a filename or a value from the failed query. */
function errorKind(err: unknown) {
  const e = err as { name?: string; code?: string }
  return { name: e?.name ?? null, code: e?.code ?? null }
}

/**
 * Step 1 of an upload: validate, choose the key on the SERVER, and sign a 60-second
 * PUT bound to this exact type and size. The browser never holds a credential.
 */
export async function getPresigned({ metadat }: { metadat: UploadMeta[] }) {
  const user = await requireProductAccess()
  const agencyId = user.agencyId as number
  for (const m of metadat) {
    const refusal = checkUpload(m)
    if (refusal) {
      logStorageEvent('upload.refused', { agencyId, userId: user.id, reason: refusal, mime: isAllowedUploadType(m.type) ? m.type : 'other', size: Number(m.size) || null })
      throw new Error(
        refusal === 'too_large'
          ? `File "${m.name}" exceeds the 10 MiB size limit.`
          : `File type "${m.type}" is not allowed. Allowed types: PDF, PNG, JPG.`,
      )
    }
  }

  const presigned = await Promise.all(
    metadat.map(async (m) => {
      const path = uploadKey(agencyId, m.type)
      const url = await presignUpload({ key: path, contentType: m.type, contentLength: m.size })
      return { url, path, ...m }
    }),
  )
  logStorageEvent('upload.presigned', { agencyId, userId: user.id, count: presigned.length })
  return presigned
}

/** The browser's PUT goes straight to R2, so its failure is only visible if the browser says so. */
export async function reportUploadFailure(input: { stage: string; httpStatus?: number | null; code?: string | null }) {
  const user = await getUser()
  if (!user) return
  const code = typeof input.code === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(input.code) ? input.code : null
  const reason = /^[a-z_]{1,30}$/.test(String(input.stage)) ? input.stage : 'unknown'
  logStorageEvent('upload.failed', {
    agencyId: user.agencyId,
    userId: user.id,
    reason,
    code,
    httpStatus: Number.isInteger(input.httpStatus) ? input.httpStatus : null,
  })
}

/**
 * Step 2: register what was uploaded. The input comes from the browser, so nothing in
 * it is trusted. Ownership decides reads (/api/files/[fileId]), so a key this agency
 * was not issued would otherwise let one tenant claim another's object. Only known
 * fields are copied, and the object itself must be what was declared.
 */
type AddFilesInput = { presigned: unknown; taskId?: number | null; clientId?: number | null }

async function verifiedFileRows(presigned: unknown, agencyId: number, userId: number) {
  if (!Array.isArray(presigned) || presigned.length === 0) throw new Error('Invalid files')
  return Promise.all(
    presigned.map(async (p) => {
      const meta = { name: String(p?.name ?? ''), type: String(p?.type ?? ''), size: Number(p?.size) }
      if (checkUpload(meta) || !isOwnUploadKey(p?.path, agencyId)) {
        logStorageEvent('upload.refused', { agencyId, userId, reason: 'invalid_registration' })
        throw new Error('Forbidden')
      }
      const head = await headObject(p.path).catch((err) => {
        if (err instanceof StorageNotFoundError) logStorageEvent('upload.refused', { agencyId, userId, reason: 'object_missing' })
        throw err
      })
      if (head.size !== meta.size || head.size > MAX_UPLOAD_BYTES || head.contentType !== meta.type) {
        await deleteObject(p.path).catch(() => undefined)
        logStorageEvent('upload.refused', { agencyId, userId, reason: 'object_mismatch', size: head.size })
        throw new Error('Forbidden')
      }
      return { ...meta, path: p.path as string }
    }),
  )
}

export async function addFilesToTask(data, clientId) {
  const fileCount = Array.isArray(data?.files) ? data.files.length : 0
  try {
    const user = await requireProductAccess()
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
    // Avoid double-logging Forbidden errors we already logged above.
    if ((err as Error)?.message !== 'Forbidden') {
      console.error('[upload] addFilesToTask.fail', JSON.stringify({ reason: 'throw', taskId: data?.taskId, fileCount, ...errorKind(err) }))
    }
    throw err
  }
}

export async function getUserImgs(userId) {
  const user = await requireProductAccess()
  const images = await db('files')
    .where({ createdById: userId, agencyId: user.agencyId, type: 'image/webp' })
    .orderBy('createdAt', 'desc')
  return images
}

export async function addFiles({ presigned, taskId = null, clientId }: AddFilesInput) {
  const user = await requireProductAccess()
  const agencyId = user.agencyId as number
  if (clientId && !(await canActOnLead(user, clientId))) throw new Error('Forbidden')
  if (taskId && !(await canActOnTask(user, taskId))) throw new Error('Forbidden')

  try {
    const verified = await verifiedFileRows(presigned, agencyId, user.id)
    const files = verified.map((f) => ({
      ...f,
      taskId,
      clientId,
      createdById: user.id,
      createdAt: new Date(),
      agencyId,
    }))
    const newFiles = await db('files').insert(files).returning('*')
    for (const f of verified) logStorageEvent('upload.completed', { agencyId, userId: user.id, mime: f.type, size: f.size })
    return newFiles
  } catch (err) {
    console.error('[upload] addFiles.fail', JSON.stringify(errorKind(err)))
    throw err
  }
}

export async function deleteFile(file) {
  const user = await requireProductAccess()
  const existing = await db('files').where({ id: file.id, agencyId: user.agencyId }).first()
  if (!existing) throw new Error('Forbidden')
  if (!(await canDeleteFile(user, existing as FileRow))) throw new Error('Forbidden')
  await db('files').where({ id: file.id, agencyId: user.agencyId }).delete()
  await removeUnreferencedObjects(user.agencyId as number, [existing.path])
  revalidatePath(`/clients/${file.clientId}/files`)
  revalidatePath(`/files`)
}

export async function addIpuyFile({ presigned, data, type }: { presigned: any; data: any; type: string }) {
  const count = Array.isArray(presigned) ? presigned.length : 0
  try {
    const user = await requireProductAccess()
    const client = await db('clients').where({ id: data.clientId, agencyId: user.agencyId }).first()
    if (!client) {
      console.warn(
        '[upload] addIpuyFile.fail',
        JSON.stringify({ reason: 'client-not-found-or-agency-mismatch', clientId: data?.clientId, type, count }),
      )
      throw new Error('Forbidden')
    }
    const verified = await verifiedFileRows(presigned, user.agencyId as number, user.id)
    const files = verified.map((p) => ({
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
    if ((err as Error)?.message !== 'Forbidden') {
      console.error('[upload] addIpuyFile.fail', JSON.stringify({ reason: 'throw', clientId: data?.clientId, type, count, ...errorKind(err) }))
    }
    throw err
  }
}
