import { COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP } from '@/lib/copilot/attachments'
import { getValidDriveAccessToken } from './driveTokens'

const FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024 // 25 MB hard ceiling

const GOOGLE_DOC = 'application/vnd.google-apps.document'
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet'
const PDF = 'application/pdf'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS = 'application/vnd.ms-excel'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOC = 'application/msword'

const COPILOT_TRACE = process.env.COPILOT_TRACE === '1'

export type DriveFileContent = {
  fileId: string
  name: string
  mimeType: string
  extractedText: string
  truncated: boolean
  originalChars: number
}

export type DriveReadFailureReason = 'unsupported-type' | 'extraction-failed' | 'empty-text' | 'too-large' | 'fetch-failed'

export type DriveReadResult = { ok: true; content: DriveFileContent } | { ok: false; reason: DriveReadFailureReason }

export async function readDriveFileContent({
  userId,
  fileId,
  name,
  mimeType,
}: {
  userId: number
  fileId: string
  name: string
  mimeType: string
}): Promise<DriveReadResult> {
  if (COPILOT_TRACE) console.info('[copilot.trace] drive.read.start', { fileId, mimeType, name })

  try {
    const raw = await dispatchRead(userId, fileId, mimeType)
    if (raw === null) {
      if (COPILOT_TRACE) console.info('[copilot.trace] drive.read.unsupported', { fileId, mimeType })
      return { ok: false, reason: 'unsupported-type' }
    }
    if (!raw.trim()) {
      return { ok: false, reason: 'empty-text' }
    }

    const originalChars = raw.length
    const truncated = originalChars > COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP
    const extractedText = truncated ? raw.slice(0, COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP) : raw

    if (COPILOT_TRACE) {
      console.info('[copilot.trace] drive.read.ok', { fileId, mimeType, originalChars, truncated })
    }

    return {
      ok: true,
      content: { fileId, name, mimeType, extractedText, truncated, originalChars },
    }
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown'
    if (message === 'file_too_large') {
      if (COPILOT_TRACE) console.warn('[copilot.trace] drive.read.too_large', { fileId, mimeType })
      return { ok: false, reason: 'too-large' }
    }
    if (message.startsWith('fetch_failed') || message.startsWith('download_failed') || message.startsWith('export_failed')) {
      if (COPILOT_TRACE) console.warn('[copilot.trace] drive.read.fetch_failed', { fileId, mimeType, message })
      return { ok: false, reason: 'fetch-failed' }
    }
    if (COPILOT_TRACE) console.warn('[copilot.trace] drive.read.extraction_failed', { fileId, mimeType, message })
    return { ok: false, reason: 'extraction-failed' }
  }
}

async function dispatchRead(userId: number, fileId: string, mimeType: string): Promise<string | null> {
  if (mimeType === GOOGLE_DOC) return exportGoogleFile(userId, fileId, 'text/plain')
  if (mimeType === GOOGLE_SHEET) return exportGoogleFile(userId, fileId, 'text/csv')
  if (mimeType.startsWith('text/')) return downloadAsText(userId, fileId)
  if (mimeType === PDF) return extractPdf(userId, fileId)
  if (mimeType === XLSX || mimeType === XLS) return extractXlsx(userId, fileId)
  if (mimeType === DOCX || mimeType === DOC) {
    // Word support requires the `mammoth` package, not currently installed.
    // Returning null surfaces this as 'unsupported-type' to the caller.
    return null
  }
  return null
}

async function exportGoogleFile(userId: number, fileId: string, exportMime: string): Promise<string> {
  const token = await getValidDriveAccessToken(userId)
  const url = `${FILES_URL}/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`export_failed ${res.status} ${body.slice(0, 200)}`)
  }
  return await res.text()
}

async function downloadAsText(userId: number, fileId: string): Promise<string> {
  const buf = await downloadBytes(userId, fileId)
  return new TextDecoder('utf-8').decode(buf)
}

async function downloadBytes(userId: number, fileId: string): Promise<Uint8Array> {
  const token = await getValidDriveAccessToken(userId)
  const url = `${FILES_URL}/${encodeURIComponent(fileId)}?alt=media`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`download_failed ${res.status} ${body.slice(0, 200)}`)
  }
  const contentLength = Number(res.headers.get('content-length') ?? '0')
  if (contentLength && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('file_too_large')
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('file_too_large')
  }
  return buf
}

type PdfjsLib = {
  GlobalWorkerOptions?: { workerSrc: string }
  getDocument: (opts: { data: Uint8Array }) => { promise: Promise<PdfDoc> }
}
type PdfDoc = {
  numPages: number
  getPage: (n: number) => Promise<PdfPage>
  destroy: () => Promise<void>
}
type PdfPage = {
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>
}

async function extractPdf(userId: number, fileId: string): Promise<string> {
  const buf = await downloadBytes(userId, fileId)

  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLib
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''

  const doc = await pdfjs.getDocument({ data: buf }).promise
  const pages: string[] = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((it) => it.str ?? '')
        .filter(Boolean)
        .join(' ')
      pages.push(pageText)
      const accumulated = pages.reduce((n, t) => n + t.length, 0)
      if (accumulated > COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP * 1.2) break
    }
  } finally {
    await doc.destroy().catch(() => {})
  }
  return pages.join('\n\n').trim()
}

async function extractXlsx(userId: number, fileId: string): Promise<string> {
  const buf = await downloadBytes(userId, fileId)
  const xlsx = await import('xlsx')
  const wb = xlsx.read(buf, { type: 'array' })
  const out: string[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const csv = xlsx.utils.sheet_to_csv(sheet, { blankrows: false })
    if (csv.trim().length === 0) continue
    out.push(`# ${sheetName}\n${csv}`)
    if (out.join('\n\n').length > COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP * 1.2) break
  }
  return out.join('\n\n').trim()
}
