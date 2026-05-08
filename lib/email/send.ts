import { baseUrl } from '@/types/vars'
import WelcomeEmail from '@/emails/templates/WelcomeEmail'
import { renderEmail } from './render'
import { sendEmail } from './sender'
import { EMAIL_ENABLED, IS_PROD } from './config'

const LOG_PREFIX = '[welcome-email]'

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

    if (!IS_PROD || !EMAIL_ENABLED) {
      console.log(
        `${LOG_PREFIX}:mock`,
        JSON.stringify({
          reason: !IS_PROD ? 'NODE_ENV is not production' : 'WELCOME_EMAIL_ENABLED is not "true"',
          to: user.email,
          firstName: user.firstName ?? null,
        }),
      )
      return
    }

    const subject = 'ברוך הבא ל-SocialCRM'
    const html = await renderEmail(
      WelcomeEmail({
        firstName: user.firstName ?? '',
        ctaUrl: `${baseUrl}/dashboard`,
      }),
    )

    const result = await sendEmail({ to: user.email, subject, html })
    if ('error' in result) {
      console.error(`${LOG_PREFIX} failed`, { to: user.email, error: result.error })
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} dispatch threw — swallowed to protect auth flow`, {
      reason: (err as Error)?.message,
    })
  }
}
