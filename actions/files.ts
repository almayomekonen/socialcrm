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

const Bucket = process.env.S3_BUCKET_NAME

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpg', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export async function getPresigned({ metadat, folderPath }: Props) {
  for (const m of metadat) {
    if (!ALLOWED_MIME_TYPES.includes(m.type)) {
      throw new Error(`File type "${m.type}" is not allowed. Allowed types: PDF, PNG, JPG.`)
    }
    if (m.size > MAX_FILE_SIZE) {
      throw new Error(`File "${m.name}" exceeds the 10 MB size limit.`)
    }
  }

  const urls = await Promise.all(
    metadat.map((m) => {
      const path = `uploads/${folderPath}/${genId()}_${m.name}`
      const cmd = new PutObjectCommand({ Bucket, Key: path, ContentType: m.type, ContentLength: m.size })
      return getSignedUrl(s3, cmd, { expiresIn: 60 }).then((url) => ({ url, path, ...m }))
    }),
  )
  return urls
}

interface Props {
  metadat: { name: string; type: string; size: number }[]
  folderPath?: string
}

export async function addFilesToTask(data, clientId) {
  await db('tasks')
    .where({ id: data.taskId })
    .update({
      files: db.raw('COALESCE(files, ARRAY[]::integer[]) || ?', [data.files]),
    })

  revalidatePath(`/clients/${clientId}/files`)
}

export async function getUserImgs(userId) {
  const images = await db('files').where({ createdById: userId, type: 'image/webp' }).orderBy('createdAt', 'desc')
  return images
}

export async function addFiles({ presigned, taskId = null, clientId }) {
  const user = await getUser()

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
}

export async function deleteFile(file) {
  await db('files').where({ id: file.id }).delete()
  revalidatePath(`/clients/${file.clientId}/files`)
  revalidatePath(`/files`)
}

export async function addIpuyFile({ presigned, data, type }: { presigned: any; data: any; type: string }) {
  presigned.map((p) => delete p.url)
  const files = presigned.map((p) => ({
    ...p,
    clientId: data.clientId,
    createdById: data.userId,
    createdAt: new Date(),
    agencyId: data.agencyId,
  }))

  const newFiles = await db('files').insert(files).returning('*')

  const expiresAt = {
    masleka: daysFromNow(90),
    harHabituach: daysFromNow(5),
    polisot: daysFromNow(30),
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
}
