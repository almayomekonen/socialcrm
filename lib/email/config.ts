/**
 * Email-config singleton — sender resolution + transient-retry status codes.
 *
 * One source of truth for the "from" address across every email flow:
 *   - lib/email/sender.ts (called by auth, invitations, welcome, billing)
 *
 * Doctrine:
 *   - One env, one sender. RESEND_FROM is the canonical name (namespaces
 *     alongside the RESEND API-key env in config/resend.ts).
 *   - WELCOME_EMAIL_FROM is honored as a deprecated fallback so existing
 *     production deployments don't break on the version that introduces
 *     this rename. Once .env.production is migrated to RESEND_FROM, the
 *     legacy var becomes dead.
 *   - The default — used when neither env is set — is the verified
 *     hello@getsocialcrm.com address. The Resend sandbox sender
 *     ('onboarding@resend.dev') is no longer referenced anywhere; the
 *     production domain is verified and accepts sends to arbitrary
 *     external recipients.
 */

export const IS_PROD = process.env.NODE_ENV === 'production'

export const EMAIL_ENABLED = process.env.WELCOME_EMAIL_ENABLED === 'true'

const DEFAULT_FROM = 'SocialCRM <hello@getsocialcrm.com>'

export function getEmailFrom(): string {
  const fromEnv =
    process.env.RESEND_FROM?.trim() ||
    // Deprecated — kept for one transition cycle so production deployments
    // that still carry the old env name continue to resolve correctly.
    process.env.WELCOME_EMAIL_FROM?.trim()
  return fromEnv || DEFAULT_FROM
}

export const TRANSIENT_RESEND_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
