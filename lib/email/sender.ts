import resend from '@/config/resend'
import { getEmailFrom, TRANSIENT_RESEND_STATUSES } from './config'

const LOG_PREFIX = '[email-send]'
const RETRY_DELAY_MS = 500

type SendInput = {
  to: string | string[]
  subject: string
  html: string
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string }

function isTransient(error: unknown): boolean {
  const status = (error as { statusCode?: number })?.statusCode
  return typeof status === 'number' && TRANSIENT_RESEND_STATUSES.has(status)
}

function errorMessage(error: unknown): string {
  return (error as { message?: string })?.message ?? 'Email send failed'
}

/**
 * Returns the first 6 chars of a key for log identification (e.g. "re_AbC1")
 * so we can tell which key is in use on prod without ever logging the secret.
 */
function keyPrefix(): string {
  const k = process.env.RESEND_API_KEY?.trim() ?? ''
  if (!k) return '(missing)'
  return `${k.slice(0, 6)}…(len=${k.length})`
}

/**
 * Identify the env source of `from` so a misconfigured fallback shows up
 * in a log line, not as "huh, everything looks right".
 */
function fromSource(): string {
  if (process.env.RESEND_FROM?.trim()) return 'RESEND_FROM'
  if (process.env.WELCOME_EMAIL_FROM?.trim()) return 'WELCOME_EMAIL_FROM (deprecated)'
  return 'default-constant'
}

export async function sendEmail({ to, subject, html }: SendInput): Promise<SendResult> {
  const from = getEmailFrom()

  // Pre-flight log: emit the full call shape BEFORE the SDK call so we have
  // ground truth even if the SDK promise never resolves (network hang) or
  // the runtime kills the function mid-send.
  console.log(`${LOG_PREFIX} attempt`, {
    from,
    fromSource: fromSource(),
    to,
    subject,
    htmlBytes: html.length,
    apiKey: keyPrefix(),
    nodeEnv: process.env.NODE_ENV ?? null,
  })

  const attempt = () => resend.emails.send({ from, to, subject, html })

  let res = await attempt()

  // Log the raw response shape every time. The previous logs only fired
  // on the success/failure branches and assumed `res.data.id` exists; a
  // degenerate "no error AND no data" response would appear as `ok: true`
  // with an empty id and silently produce a missing email.
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

  // The id should always be present on a real success. If we get here with
  // an empty id, the Resend SDK returned a degenerate success — we now
  // surface that as a hard failure rather than reporting `success: true`
  // to the caller and letting the user wait for an email that won't come.
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
