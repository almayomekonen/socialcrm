import { db } from '@/config/db'

export type LeadDriveFileRow = {
  id: number
  lead_id: number
  agency_id: number
  created_by_user_id: number
  drive_file_id: string
  name: string
  mime_type: string
  web_view_link: string | null
  created_at: Date
}

/**
 * Upsert by (lead_id, drive_file_id) — re-attaching the same file is a no-op.
 * Returns the (possibly existing) row id.
 */
export async function attachDriveFileToLead(input: {
  leadId: number
  agencyId: number
  userId: number
  driveFileId: string
  name: string
  mimeType: string
  webViewLink: string | null
}): Promise<number> {
  const [row] = await db('lead_drive_files')
    .insert({
      lead_id: input.leadId,
      agency_id: input.agencyId,
      created_by_user_id: input.userId,
      drive_file_id: input.driveFileId,
      name: input.name,
      mime_type: input.mimeType,
      web_view_link: input.webViewLink,
    })
    .onConflict(['lead_id', 'drive_file_id'])
    .merge({
      // Refresh name / mime / link if they changed in Drive since the prior
      // attachment. The id and created_at stay stable.
      name: input.name,
      mime_type: input.mimeType,
      web_view_link: input.webViewLink,
    })
    .returning('id')
  return row.id as number
}

export async function listDriveFilesForLead({
  leadId,
  agencyId,
}: {
  leadId: number
  agencyId: number
}): Promise<LeadDriveFileRow[]> {
  return (await db('lead_drive_files')
    .where({ lead_id: leadId, agency_id: agencyId })
    .orderBy('created_at', 'desc')) as LeadDriveFileRow[]
}

export async function getDriveFileAttachmentById({
  id,
  agencyId,
}: {
  id: number
  agencyId: number
}): Promise<LeadDriveFileRow | null> {
  const row = await db('lead_drive_files').where({ id, agency_id: agencyId }).first()
  return (row ?? null) as LeadDriveFileRow | null
}

export async function detachDriveFileFromLead({
  id,
  agencyId,
}: {
  id: number
  agencyId: number
}): Promise<void> {
  await db('lead_drive_files').where({ id, agency_id: agencyId }).delete()
}
