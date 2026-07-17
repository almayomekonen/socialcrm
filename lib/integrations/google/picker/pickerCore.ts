export const DRIVE_PICKER_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

export type PickedDriveFile = {
  driveFileId: string
  name: string
  mimeType: string
  webViewLink: string | null
}

export type PickerClientConfig = {
  clientId: string
  apiKey: string
  appId: string
}

export function isDrivePickerEnabled(): boolean {
  return process.env.DRIVE_PICKER_ENABLED === 'true'
}

export function getPickerClientConfig(): PickerClientConfig | null {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY
  const appId = process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID
  if (!clientId || !apiKey || !appId) return null
  return { clientId, apiKey, appId }
}

export function mapPickedFile(doc: Record<string, unknown>): PickedDriveFile | null {
  const id = typeof doc.id === 'string' ? doc.id : null
  const name = typeof doc.name === 'string' ? doc.name : null
  if (!id || !name) return null
  const mimeType = typeof doc.mimeType === 'string' ? doc.mimeType : 'application/octet-stream'
  const url = typeof doc.url === 'string' ? doc.url : null
  return { driveFileId: id, name, mimeType, webViewLink: url }
}
