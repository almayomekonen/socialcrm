import { createHash } from 'node:crypto'
import { diagDb, type DiagCtx } from '../diag'

const RENDER_TIMEOUT_MS = Number(process.env.PDF_RENDER_TIMEOUT_MS ?? 60_000)

export type HtmlToPdfResult = {
  bytes: Uint8Array
  contentHash: string
  byteSize: number
}

function readConfig(): { url: string; token: string } {
  const url = process.env.PDF_RENDER_URL?.trim()
  const token = process.env.PDF_RENDER_TOKEN?.trim()
  if (!url) throw new Error('billing.pdf.config_missing:PDF_RENDER_URL')
  if (!token) throw new Error('billing.pdf.config_missing:PDF_RENDER_TOKEN')
  return { url: url.replace(/\/$/, ''), token }
}

function log(stage: string, payload: Record<string, unknown> = {}): void {
  console.log(`[billing.pdf] ${stage}`, JSON.stringify(payload))
}

export async function htmlToPdfBytes(html: string, ctx: DiagCtx | null = null): Promise<HtmlToPdfResult> {
  const t0 = Date.now()
  const { url, token } = readConfig()
  const endpoint = `${url}/forms/chromium/convert/html`

  await diagDb(ctx, 'gotenberg.fetch.before', { endpoint, htmlBytes: html.length })
  log('render.start', { endpoint, htmlBytes: html.length })

  const form = new FormData()
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  form.append('paperWidth', '8.27')
  form.append('paperHeight', '11.7')
  form.append('marginTop', '0')
  form.append('marginBottom', '0')
  form.append('marginLeft', '0')
  form.append('marginRight', '0')
  form.append('preferCssPageSize', 'true')
  form.append('printBackground', 'true')

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'X-Render-Token': token },
      body: form,
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Unknown'
    const message = err instanceof Error ? err.message : String(err)
    const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error'
    await diagDb(ctx, 'gotenberg.fetch.error', { reason, errorName: name, message: message.slice(0, 240), durationMs: Date.now() - t0 })
    log('render.fail', { reason, message: message.slice(0, 240), durationMs: Date.now() - t0 })
    throw new Error(`billing.pdf.gotenberg_${reason}:${message.slice(0, 120)}`)
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    await diagDb(ctx, 'gotenberg.fetch.bad_status', { status: response.status, bodyExcerpt: bodyText.slice(0, 240), durationMs: Date.now() - t0 })
    log('render.fail', { reason: 'bad_status', status: response.status, durationMs: Date.now() - t0 })
    if (response.status === 403) {
      throw new Error('billing.pdf.gotenberg_forbidden:check_PDF_RENDER_TOKEN')
    }
    throw new Error(`billing.pdf.gotenberg_bad_status:${response.status}:${bodyText.slice(0, 120)}`)
  }

  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const durationMs = Date.now() - t0

  await diagDb(ctx, 'gotenberg.fetch.after', {
    status: response.status,
    contentType: response.headers.get('content-type') ?? null,
    byteSize: bytes.byteLength,
    durationMs,
  })
  log('render.ok', { byteSize: bytes.byteLength, durationMs })

  return { bytes, contentHash, byteSize: bytes.byteLength }
}
