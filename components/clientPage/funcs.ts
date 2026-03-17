export function getFileType(mimeType) {
  if (!mimeType) return 'other'

  const type = mimeType.toLowerCase()

  if (type === 'application/pdf') return 'pdf'
  if (type.startsWith('image/')) return 'image'

  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    type === 'application/msword' ||
    type.includes('word')
  )
    return 'word'

  if (
    type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    type === 'application/vnd.ms-excel' ||
    type.includes('excel') ||
    type.includes('spreadsheet')
  )
    return 'excel'

  return 'other'
}
