export const IS_PROD = process.env.NODE_ENV === 'production'

export const EMAIL_ENABLED = process.env.WELCOME_EMAIL_ENABLED === 'true'

function resolveEmailFrom(): string {
  const fromEnv = process.env.WELCOME_EMAIL_FROM?.trim()
  if (fromEnv) return fromEnv
  if (IS_PROD) {
    throw new Error('[email/config] WELCOME_EMAIL_FROM is not set in production. Refusing to send from a sandbox sender.')
  }
  return 'SocialCRM <onboarding@resend.dev>'
}

export const EMAIL_FROM = resolveEmailFrom()

export const TRANSIENT_RESEND_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
