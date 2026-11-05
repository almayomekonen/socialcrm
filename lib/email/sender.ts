import resend from '@/config/resend'
import { getEmailFrom, TRANSIENT_RESEND_STATUSES } from './config'

const LOG_PREFIX = '[email-send]'
const RETRY_DELAY_MS = 500

type SendInput = {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string | string[]
  // Explicit sender override. Platform email omits this (one-sender doctrine,
  // getEmailFrom in ./config); the customer-automation domain passes its own
  // sending identity. The transport carries the address — sender policy stays
  // with each domain's caller.
  from?: string
  /**
   * Extra RFC 5322 headers, on the same principle as `from`: the transport
   * carries them, the calling domain decides them. The customer-automation
   * domain uses this for List-Unsubscribe; platform email passes nothing and is
   * byte-for-byte unchanged.
   */
  headers?: Record<string, string>
  /** Files sent with the message, for example a private invoice PDF. Never logged. */
  attachments?: { filename: string; content: Buffer }[]
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string }

function isTransient(error: unknown): boolean {
  const status = (error as { statusCode?: number })?.statusCode
  return typeof status === 'number' && TRANSIENT_RESEND_STATUSES.has(status)
}

/** Provider text can quote the address it refused, and callers log what they get back. */
function errorMessage(error: unknown): string {
  const message = (error as { message?: string })?.message ?? 'Email send failed'
  return message.replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, '[email]')
}

/**
 * What may be logged about a failure. The Vercel logs drain to Axiom, so a recipient, a
 * subject (it can name a customer) or part of the API key logged here is kept there too.
 */
function errorFields(error: unknown) {
  const e = error as { name?: string; statusCode?: number } | null
  return { errorName: e?.name ?? null, errorStatusCode: e?.statusCode ?? null }
}

function fromSource(): string {
  if (process.env.RESEND_FROM?.trim()) return 'RESEND_FROM'
  if (process.env.WELCOME_EMAIL_FROM?.trim()) return 'WELCOME_EMAIL_FROM (deprecated)'
  return 'default-constant'
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  from: explicitFrom,
  headers,
  attachments,
}: SendInput): Promise<SendResult> {
  const from = explicitFrom?.trim() || getEmailFrom()

  console.log(`${LOG_PREFIX} attempt`, {
    fromSource: explicitFrom?.trim() ? 'explicit-caller' : fromSource(),
    htmlBytes: html.length,
    textBytes: text?.length ?? 0,
    attachments: attachments?.length ?? 0,
    nodeEnv: process.env.NODE_ENV ?? null,
  })

  const attempt = () => {
    const payload: Parameters<typeof resend.emails.send>[0] = { from, to, subject, html }
    if (text) payload.text = text
    if (replyTo) payload.replyTo = replyTo
    if (headers && Object.keys(headers).length > 0) payload.headers = headers
    if (attachments?.length) payload.attachments = attachments
    return resend.emails.send(payload)
  }

  let res = await attempt()

  console.log(`${LOG_PREFIX} response.raw`, { hasData: !!res.data, dataId: res.data?.id ?? null, ...errorFields(res.error) })

  if (res.error && isTransient(res.error)) {
    console.log(`${LOG_PREFIX} retry.transient`, errorFields(res.error))
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    res = await attempt()
    console.log(`${LOG_PREFIX} response.raw.retry`, { hasData: !!res.data, dataId: res.data?.id ?? null, ...errorFields(res.error) })
  }

  if (res.error) {
    const msg = errorMessage(res.error)
    console.error(`${LOG_PREFIX} failed`, errorFields(res.error))
    return { ok: false, error: msg }
  }

  const id = res.data?.id ?? ''
  if (!id) {
    console.error(`${LOG_PREFIX} failed.no_id`, { reason: 'Resend returned no error and no message id — treating as failure to avoid silent loss' })
    return { ok: false, error: 'no_message_id' }
  }

  console.log(`${LOG_PREFIX} sent`, { id })
  return { ok: true, id }
}
