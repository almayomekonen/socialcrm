import { diagDb, type DiagCtx } from '../diag'

const DISPATCH_TIMEOUT_MS = Number(process.env.PDF_RENDER_TIMEOUT_MS ?? 30_000)

export type DispatchInput = {
  html: string
  webhookUrl: string
  errorUrl: string
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

/**
 * Dispatch an HTML-to-PDF render to Gotenberg in webhook mode. Gotenberg
 * accepts the POST, returns 204 immediately, then renders asynchronously
 * and uploads the resulting PDF directly to `webhookUrl` via PUT (which
 * is an S3 presigned PUT URL in production).
 *
 * This function intentionally never receives the PDF bytes. The whole
 * point is to remove the Vercel runtime from the PDF transport path:
 * the PDF flows Gotenberg (eu-north-1) -> S3 (eu-north-1) without ever
 * crossing the Atlantic or transiting through this function.
 */
export async function dispatchHtmlToPdf({ html, webhookUrl, errorUrl }: DispatchInput, ctx: DiagCtx | null = null): Promise<void> {
  const t0 = Date.now()
  const { url, token } = readConfig()
  const endpoint = `${url}/forms/chromium/convert/html`

  await diagDb(ctx, 'gotenberg.dispatch.before', { endpoint, htmlBytes: html.length })
  log('render.dispatch.start', { endpoint, htmlBytes: html.length })

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
      headers: {
        'X-Render-Token': token,
        'Gotenberg-Webhook-Url': webhookUrl,
        'Gotenberg-Webhook-Method': 'PUT',
        'Gotenberg-Webhook-Extra-Http-Headers': JSON.stringify({ 'Content-Type': 'application/pdf' }),
        'Gotenberg-Webhook-Error-Url': errorUrl,
        'Gotenberg-Webhook-Error-Method': 'POST',
      },
      body: form,
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Unknown'
    const message = err instanceof Error ? err.message : String(err)
    const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error'
    await diagDb(ctx, 'gotenberg.dispatch.error', { reason, errorName: name, message: message.slice(0, 240), durationMs: Date.now() - t0 })
    log('render.dispatch.fail', { reason, message: message.slice(0, 240), durationMs: Date.now() - t0 })
    throw new Error(`billing.pdf.gotenberg_${reason}:${message.slice(0, 120)}`)
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    await diagDb(ctx, 'gotenberg.dispatch.bad_status', { status: response.status, bodyExcerpt: bodyText.slice(0, 240), durationMs: Date.now() - t0 })
    log('render.dispatch.fail', { reason: 'bad_status', status: response.status, durationMs: Date.now() - t0 })
    if (response.status === 403) {
      throw new Error('billing.pdf.gotenberg_forbidden:check_PDF_RENDER_TOKEN')
    }
    throw new Error(`billing.pdf.gotenberg_bad_status:${response.status}:${bodyText.slice(0, 120)}`)
  }

  const durationMs = Date.now() - t0
  await diagDb(ctx, 'gotenberg.dispatch.after', { status: response.status, durationMs })
  log('render.dispatch.ok', { durationMs })
}
