import { getValidDriveAccessToken } from './driveTokens'

const FILES_URL = 'https://www.googleapis.com/drive/v3/files'

export type DriveSearchResult = {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  webViewLink: string | null
  thumbnailLink: string | null
}

const FIELDS = 'files(id,name,mimeType,modifiedTime,webViewLink,thumbnailLink)'

const COPILOT_TRACE = process.env.COPILOT_TRACE === '1'

export async function searchUserDrive({
  userId,
  query,
  limit = 10,
}: {
  userId: number
  query: string
  limit?: number
}): Promise<DriveSearchResult[]> {
  const token = await getValidDriveAccessToken(userId)

  const pageSize = Math.min(Math.max(limit, 1), 100)
  const q = query.trim() ? `${query} and trashed = false` : 'trashed = false'

  const params = new URLSearchParams({
    q,
    fields: FIELDS,
    pageSize: String(pageSize),
    spaces: 'drive',
    orderBy: 'modifiedTime desc',
  })

  if (COPILOT_TRACE) {
    console.info('[copilot.trace] drive.request', {
      q,
      pageSize,
      orderBy: 'modifiedTime desc',
      fields: FIELDS,
    })
  }

  const res = await fetch(`${FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`drive_search_failed: ${res.status} ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    files?: Array<{
      id?: string
      name?: string
      mimeType?: string
      modifiedTime?: string
      webViewLink?: string
      thumbnailLink?: string
    }>
  }

  const results: DriveSearchResult[] = (data.files ?? [])
    .filter(
      (f): f is Required<Pick<typeof f, 'id' | 'name'>> & typeof f => typeof f.id === 'string' && typeof f.name === 'string',
    )
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType ?? 'application/octet-stream',
      modifiedTime: f.modifiedTime ?? '',
      webViewLink: f.webViewLink ?? null,
      thumbnailLink: f.thumbnailLink ?? null,
    }))

  if (COPILOT_TRACE) {
    console.info('[copilot.trace] drive.response', {
      rawCount: data.files?.length ?? 0,
      returnedCount: results.length,
      firstNames: results.slice(0, 10).map((r) => r.name),
      mimeTypes: results.slice(0, 10).map((r) => r.mimeType),
    })
    if (results.length === 0) {
      console.info('[copilot.trace] drive.empty_result')
    }
  }

  return results
}
