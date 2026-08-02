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
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string }

function isTransient(error: unknown): boolean {
  const status = (error as { statusCode?: number })?.statusCode
  return typeof status === 'number' && TRANSIENT_RESEND_STATUSES.has(status)
}

function errorMessage(error: unknown): string {
  return (error as { message?: string })?.message ?? 'Email send failed'
}

function keyPrefix(): string {
  const k = process.env.RESEND_API_KEY?.trim() ?? ''
  if (!k) return '(missing)'
  return `${k.slice(0, 6)}…(len=${k.length})`
}

function fromSource(): string {
  if (process.env.RESEND_FROM?.trim()) return 'RESEND_FROM'
  if (process.env.WELCOME_EMAIL_FROM?.trim()) return 'WELCOME_EMAIL_FROM (deprecated)'
  return 'default-constant'
}

export async function sendEmail({ to, subject, html, text, replyTo, from: explicitFrom }: SendInput): Promise<SendResult> {
  const from = explicitFrom?.trim() || getEmailFrom()

  console.log(`${LOG_PREFIX} attempt`, {
    from,
    fromSource: explicitFrom?.trim() ? 'explicit-caller' : fromSource(),
    to,
    subject,
    htmlBytes: html.length,
    textBytes: text?.length ?? 0,
    apiKey: keyPrefix(),
    nodeEnv: process.env.NODE_ENV ?? null,
  })

  const attempt = () => {
    const payload: Parameters<typeof resend.emails.send>[0] = { from, to, subject, html }
    if (text) payload.text = text
    if (replyTo) payload.replyTo = replyTo
    return resend.emails.send(payload)
  }

  let res = await attempt()

  console.log(`${LOG_PREFIX} response.raw`, {
    hasData: !!res.data,
    hasError: !!res.error,
    dataId: res.data?.id ?? null,
    errorName: (res.error as { name?: string } | null)?.name ?? null,
    errorMessage: (res.error as { message?: string } | null)?.message ?? null,
    errorStatusCode: (res.error as { statusCode?: number } | null)?.statusCode ?? null,
  })

  if (res.error && isTransient(res.error)) {
    console.log(`${LOG_PREFIX} retry.transient`, { errorMessage: errorMessage(res.error) })
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    res = await attempt()
    console.log(`${LOG_PREFIX} response.raw.retry`, {
      hasData: !!res.data,
      hasError: !!res.error,
      dataId: res.data?.id ?? null,
      errorMessage: (res.error as { message?: string } | null)?.message ?? null,
    })
  }

  if (res.error) {
    const msg = errorMessage(res.error)
    console.error(`${LOG_PREFIX} failed`, { to, subject, reason: msg })
    return { ok: false, error: msg }
  }

  const id = res.data?.id ?? ''
  if (!id) {
    console.error(`${LOG_PREFIX} failed.no_id`, {
      to,
      subject,
      reason: 'Resend returned no error and no message id — treating as failure to avoid silent loss',
    })
    return { ok: false, error: 'no_message_id' }
  }

  console.log(`${LOG_PREFIX} sent`, { to, subject, id })
  return { ok: true, id }
}
