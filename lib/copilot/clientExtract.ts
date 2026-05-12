import { COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP, inferCopilotMediaType } from './attachments'

export type ExtractedAttachment =
  | { kind: 'text'; name: string; mediaType: string; size: number; content: string; truncated: boolean; originalChars: number }
  | { kind: 'image'; name: string; mediaType: string; size: number }
  | { kind: 'unsupported'; name: string; mediaType: string; size: number; reason: 'unsupported-type' | 'extraction-failed' }

const PDF_MIME = 'application/pdf'
const EXCEL_MIMES = new Set(['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

export async function extractFile(file: File): Promise<ExtractedAttachment> {
  const mediaType = inferCopilotMediaType(file.name, file.type)
  const meta = { name: file.name, mediaType, size: file.size }

  try {
    if (mediaType === PDF_MIME) {
      const raw = await extractPdfText(file)
      return capText(raw, meta)
    }

    if (EXCEL_MIMES.has(mediaType) || /\.xlsx?$/i.test(file.name)) {
      const raw = await extractExcelText(file)
      return capText(raw, meta)
    }

    if (IMAGE_MIMES.has(mediaType)) {
      return { kind: 'image', ...meta }
    }

    return { kind: 'unsupported', ...meta, reason: 'unsupported-type' }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[copilot] extract.failed', meta, err)
      if (process.env.NEXT_PUBLIC_COPILOT_TRACE === '1') {
        console.info('[copilot.trace] extract.failed.details', { meta, error: (err as Error)?.message })
      }
    }
    return { kind: 'unsupported', ...meta, reason: 'extraction-failed' }
  }
}

function capText(raw: string, meta: { name: string; mediaType: string; size: number }): ExtractedAttachment {
  const originalChars = raw.length
  if (originalChars <= COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP) {
    return { kind: 'text', ...meta, content: raw, truncated: false, originalChars }
  }
  return {
    kind: 'text',
    ...meta,
    content: raw.slice(0, COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP),
    truncated: true,
    originalChars,
  }
}

let pdfWorkerReady: Promise<(typeof import('react-pdf'))['pdfjs']> | null = null

const PDF_WORKER_URL = '/copilot/pdf.worker.min.mjs'

async function loadPdfjs(): Promise<(typeof import('react-pdf'))['pdfjs']> {
  if (pdfWorkerReady) return pdfWorkerReady
  pdfWorkerReady = (async () => {
    const { pdfjs } = await import('react-pdf')
    const previous = pdfjs.GlobalWorkerOptions.workerSrc
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL
    if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_COPILOT_TRACE === '1') {
      console.info('[copilot.trace] pdf.worker.configured', {
        previousWorkerSrc: previous || '(unset)',
        nextWorkerSrc: pdfjs.GlobalWorkerOptions.workerSrc,
        pdfjsVersion: (pdfjs as { version?: string }).version ?? 'unknown',
      })
    }
    return pdfjs
  })()
  return pdfWorkerReady
}

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdfjs = await loadPdfjs()

  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_COPILOT_TRACE === '1') {
    console.info('[copilot.trace] pdf.getDocument.start', {
      file: file.name,
      bytes: arrayBuffer.byteLength,
      workerSrc: pdfjs.GlobalWorkerOptions.workerSrc,
    })
  }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const pages: string[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ')
    pages.push(pageText)
    const accumulated = pages.reduce((n, t) => n + t.length, 0)
    if (accumulated > COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP * 1.2) break
  }
  await doc.destroy()
  const result = pages.join('\n\n').trim()
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_COPILOT_TRACE === '1') {
    console.info('[copilot.trace] pdf.extracted', {
      name: file.name,
      pages: doc.numPages,
      chars: result.length,
      preview: result.slice(0, 200),
    })
  }
  return result
}

async function extractExcelText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const xlsx = await import('xlsx')
  const wb = xlsx.read(new Uint8Array(arrayBuffer), { type: 'array' })
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
