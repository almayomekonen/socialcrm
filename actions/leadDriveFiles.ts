'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import {
  attachDriveFileToLead,
  detachDriveFileFromLead,
  getDriveFileAttachmentById,
  listDriveFilesForLead,
  type LeadDriveFileRow,
} from '@/db/leadDriveFiles'
import { getFullLead } from '@/db/clients'

export type LeadDriveAttachment = {
  id: number
  driveFileId: string
  name: string
  mimeType: string
  webViewLink: string | null
  createdAt: string
}

function toAttachment(row: LeadDriveFileRow): LeadDriveAttachment {
  return {
    id: row.id,
    driveFileId: row.drive_file_id,
    name: row.name,
    mimeType: row.mime_type,
    webViewLink: row.web_view_link,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

export async function listLeadDriveAttachments(leadIdRaw: number | string): Promise<LeadDriveAttachment[]> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return []

  const user = await requireAgencyUser()
  const rows = await listDriveFilesForLead({ leadId, agencyId: user.agencyId })
  return rows.map(toAttachment)
}

export type AttachInput = {
  leadId: number | string
  driveFileId: string
  name: string
  mimeType: string
  webViewLink: string | null
}

export async function attachDriveFile(input: AttachInput): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  const leadId = Number(input.leadId)
  if (!Number.isFinite(leadId) || leadId <= 0) return { ok: false, reason: 'invalid-lead' }
  if (!input.driveFileId || !input.name) return { ok: false, reason: 'invalid-file' }

  const user = await requireAgencyUser()

  // Verify the lead belongs to the user's agency by confirming a row exists.
  const lead = await getFullLead({ id: leadId, select: ['name'] }).catch(() => null)
  if (!lead?.name) return { ok: false, reason: 'lead-not-found' }

  try {
    const id = await attachDriveFileToLead({
      leadId,
      agencyId: user.agencyId,
      userId: user.id,
      driveFileId: input.driveFileId,
      name: input.name.slice(0, 255),
      mimeType: (input.mimeType || 'application/octet-stream').slice(0, 255),
      webViewLink: input.webViewLink,
    })
    revalidatePath(`/clients/${leadId}/files`)
    return { ok: true, id }
  } catch (err) {
    console.warn('[leadDriveFiles.attach] failed', { leadId, error: (err as Error)?.message })
    return { ok: false, reason: 'db' }
  }
}

export async function detachDriveFile(attachmentIdRaw: number | string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const attachmentId = Number(attachmentIdRaw)
  if (!Number.isFinite(attachmentId) || attachmentId <= 0) return { ok: false, reason: 'invalid-id' }

  const user = await requireAgencyUser()
  const row = await getDriveFileAttachmentById({ id: attachmentId, agencyId: user.agencyId })
  if (!row) return { ok: false, reason: 'not-found' }

  await detachDriveFileFromLead({ id: attachmentId, agencyId: user.agencyId })
  revalidatePath(`/clients/${row.lead_id}/files`)
  return { ok: true }
}
