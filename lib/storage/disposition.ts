/**
 * A Content-Disposition header for a customer-named file. Hebrew survives through
 * RFC 5987 `filename*`, with an ASCII `filename` for older clients. Pure.
 */

const HOSTILE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

export function safeFilename(name: unknown, fallback = 'file'): string {
  const cleaned = String(name ?? '').replace(HOSTILE, '').trim().slice(0, 150)
  return cleaned || fallback
}

function encodeRfc5987(value: string): string {
  // encodeURIComponent leaves these unescaped, and RFC 5987 does not allow them.
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function contentDisposition(name: unknown, mode: 'inline' | 'attachment' = 'attachment'): string {
  const filename = safeFilename(name)
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_')
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(filename)}`
}
