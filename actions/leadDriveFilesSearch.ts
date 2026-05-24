'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { listDriveFilesForLead } from '@/db/leadDriveFiles'
import { getFullLead } from '@/db/clients'
import { searchUserDrive, type DriveSearchResult } from '@/lib/integrations/google/driveClient'
import { DriveAuthError } from '@/lib/integrations/google/driveTokens'

export type SuggestedDriveFile = {
  driveFileId: string
  name: string
  mimeType: string
  modifiedTime: string
  webViewLink: string | null
  thumbnailLink: string | null
}

/**
 * Drive search seeded from the lead's identifying fields (name / email /
 * phone). Returns results not yet attached to this lead so the UI can show
 * one-click attach options.
 *
 * Failure modes (no Drive connection, search error, etc.) are swallowed —
 * the lead view never breaks because Drive is unavailable.
 */
export async function fetchSuggestedDriveFiles(leadIdRaw: number | string): Promise<SuggestedDriveFile[]> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return []

  const user = await requireAgencyUser()
  const lead = await getFullLead({ id: leadId, select: ['name', 'email', 'phone'] }).catch(() => null)
  if (!lead?.name) return []

  const query = buildSuggestQuery({
    name: typeof lead.name === 'string' ? lead.name : null,
    email: typeof lead.email === 'string' ? lead.email : null,
    phone: typeof lead.phone === 'string' ? lead.phone : null,
  })
  if (!query) return []

  return runFilteredSearch({ userId: user.id, query, leadId, agencyId: user.agencyId })
}

/**
 * Free-text Drive search for the attach modal. Returns at most 10 matches,
 * filtered to remove files already attached to this lead.
 */
export async function searchDriveForLead({
  leadId: leadIdRaw,
  query,
}: {
  leadId: number | string
  query: string
}): Promise<SuggestedDriveFile[]> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return []
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const user = await requireAgencyUser()
  const escaped = trimmed.replace(/'/g, "\\'")
  const driveQuery = `(name contains '${escaped}' or fullText contains '${escaped}')`

  return runFilteredSearch({ userId: user.id, query: driveQuery, leadId, agencyId: user.agencyId })
}

async function runFilteredSearch({
  userId,
  query,
  leadId,
  agencyId,
}: {
  userId: number
  query: string
  leadId: number
  agencyId: number
}): Promise<SuggestedDriveFile[]> {
  let results: DriveSearchResult[]
  try {
    results = await searchUserDrive({ userId, query, limit: 10 })
  } catch (err) {
    if (err instanceof DriveAuthError) return []
    console.warn('[leadDriveFilesSearch] failed', { leadId, error: (err as Error)?.message })
    return []
  }

  // Filter out files already attached so the UI shows only fresh candidates.
  const attached = await listDriveFilesForLead({ leadId, agencyId })
  const attachedIds = new Set(attached.map((a) => a.drive_file_id))

  return results
    .filter((r) => !attachedIds.has(r.id))
    .map((r) => ({
      driveFileId: r.id,
      name: r.name,
      mimeType: r.mimeType,
      modifiedTime: r.modifiedTime,
      webViewLink: r.webViewLink,
      thumbnailLink: r.thumbnailLink,
    }))
}

/**
 * Build a Drive `q` expression that surfaces files mentioning the lead.
 * Phone is OR'd in because a contract may have only the phone, not the name;
 * email is similarly identifying. Each token clause matches name OR fullText
 * — Drive de-duplicates files matched by both.
 */
function buildSuggestQuery({
  name,
  email,
  phone,
}: {
  name: string | null
  email: string | null
  phone: string | null
}): string | null {
  const terms: string[] = []
  if (name) {
    for (const t of name.split(/\s+/).filter((s) => s.length >= 2)) terms.push(t)
  }
  if (email) terms.push(email)
  if (phone) {
    const digits = phone.replace(/\D/g, '')
    if (digits.length >= 6) terms.push(digits)
  }
  if (terms.length === 0) return null

  const clauses = terms.map(
    (t) => `(name contains '${escapeSingleQuotes(t)}' or fullText contains '${escapeSingleQuotes(t)}')`,
  )
  return clauses.join(' or ')
}

function escapeSingleQuotes(s: string): string {
  return s.replace(/'/g, "\\'")
}
