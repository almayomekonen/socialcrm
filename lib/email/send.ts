import resend from '@/config/resend'
import { baseUrl } from '@/types/vars'
import WelcomeEmail from '@/emails/templates/WelcomeEmail'
import { renderEmail } from './render'

const LOG_PREFIX = '[welcome-email]'

const FALLBACK_FROM = 'SocialCRM <onboarding@resend.dev>'

type WelcomeRecipient = {
  email: string
  firstName?: string | null
}

export async function sendWelcomeEmail(user: WelcomeRecipient): Promise<void> {
  try {
    if (!user?.email) {
      console.warn(`${LOG_PREFIX} skipped — missing recipient email`)
      return
    }

    const enabled = process.env.WELCOME_EMAIL_ENABLED === 'true'
    const isProd = process.env.NODE_ENV === 'production'
    const testRecipient = process.env.WELCOME_EMAIL_TEST_RECIPIENT?.trim() || null

    const recipient = !isProd && testRecipient ? testRecipient : user.email

    const subject = 'ברוך הבא ל-SocialCRM'
    const html = await renderEmail(
      WelcomeEmail({
        firstName: user.firstName ?? '',
        ctaUrl: baseUrl,
      }),
    )

    // TEMPORARY DEV TESTING: gating on WELCOME_EMAIL_ENABLED only, ignoring NODE_ENV.
    // REVERT BEFORE PRODUCTION DEPLOY: restore `if (!isProd || !enabled)` to prevent
    // accidental real sends from dev/test environments.
    if (!enabled) {
      console.log(
        `${LOG_PREFIX}:mock`,
        JSON.stringify({
          reason: 'WELCOME_EMAIL_ENABLED is not "true"',
          to: recipient,
          subject,
          firstName: user.firstName ?? null,
        }),
      )
      return
    }

    const from = process.env.WELCOME_EMAIL_FROM?.trim() || FALLBACK_FROM

    const { error } = await resend.emails.send({
      from,
      to: recipient,
      subject,
      html,
    })

    if (error) {
      console.error(`${LOG_PREFIX} resend returned error`, {
        to: recipient,
        reason: (error as { message?: string })?.message ?? error,
      })
      return
    }

    console.log(`${LOG_PREFIX} sent`, { to: recipient })
  } catch (err) {
    console.error(`${LOG_PREFIX} dispatch threw — swallowed to protect auth flow`, {
      reason: (err as Error)?.message,
    })
  }
}
