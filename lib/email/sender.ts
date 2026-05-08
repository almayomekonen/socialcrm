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

export async function sendEmail({ to, subject, html }: SendInput): Promise<SendResult> {
  const attempt = () => resend.emails.send({ from: getEmailFrom(), to, subject, html })

  let res = await attempt()

  if (res.error && isTransient(res.error)) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    res = await attempt()
  }

  if (res.error) {
    const msg = errorMessage(res.error)
    console.error(`${LOG_PREFIX} failed`, { to, subject, reason: msg })
    return { ok: false, error: msg }
  }

  console.log(`${LOG_PREFIX} sent`, { to, subject, id: res.data?.id })
  return { ok: true, id: res.data?.id ?? '' }
}
