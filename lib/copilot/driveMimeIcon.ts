import type { IconNames } from '@/lib/Icon'

// Single source of truth for mapping a Drive mimeType to an Icon name from
// the existing icon registry. Used by DriveResultsBody, LeadDriveSection
// (and its rows), and LeadDriveAttachModal — keep them all consuming this so
// the canonical mapping never drifts across surfaces.
export function iconForDriveMime(mimeType: string): IconNames {
  if (mimeType === 'application/vnd.google-apps.folder') return 'folder'
  if (mimeType === 'application/pdf') return 'file-pdf'
  if (mimeType.startsWith('image/')) return 'file-image'
  if (mimeType.startsWith('video/')) return 'file-video'
  if (
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    return 'file-spreadsheet'
  }
  if (
    mimeType === 'application/vnd.google-apps.document' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    return 'file-word'
  }
  if (mimeType.startsWith('text/')) return 'file-lines'
  return 'file'
}
