/**
 * PLATFORM EMAILS — SocialCRM → its own users ONLY.
 *
 * Everything under lib/emailAutomations/ is the platform email domain:
 * lifecycle/transactional email to platform users, keyed by userId. It must
 * never send to leads, and the customer-automation domain (lib/automations/**
 * and siblings) must never import from here — nor the reverse. Boundary
 * contract: docs/email-automations-plan.md §0; enforced by
 * __tests__/automations/boundary.test.ts.
 */
import type { Automation } from './types'
import { IS_PROD, EMAIL_ENABLED } from '@/lib/email/config'
import { appUrl } from './config'
import { lifecycleOwners } from './recipients'
import WelcomeEmail from '@/emails/templates/WelcomeEmail'
import { STATE_CONTENT } from './content/state'
import { EVENT_CONTENT } from './content/event'
import { EDUCATIONAL } from './content/educational'
import { contentToAutomation } from './contentToAutomation'
import { resolveNextEducational } from './journey'
import { cardTrialStarted, cardTrialChargeReminder } from './cardTrial'

// Welcome keeps its rich transactional template + legacy WELCOME_EMAIL_ENABLED
// gate. It is the one automation that is not content-driven, on purpose.
const welcome: Automation = {
  key: 'welcome',
  description: 'Sent once on registration. Reuses the existing WelcomeEmail template.',
  enabled: true,
  priority: 'high',
  order: 0,
  category: 'transactional',
  trigger: 'event',
  event: 'user.registered',
  gate: () => IS_PROD && EMAIL_ENABLED,
  subject: () => '🚀 ברוכים הבאים ל-SocialCRM',
  template: (r) => WelcomeEmail({ firstName: r.firstName ?? '', ctaUrl: appUrl('/dashboard') }),
}

// The educational journey is ONE dynamic automation. Its per-recipient content
// is resolved by resolveNextEducational (the next undelivered educational email),
// so adding an educational email = appending to EDUCATIONAL, never a new
// automation. Runs last (low priority, high order) so state-triggered emails win.
const educationalJourney: Automation = {
  key: 'educational_journey',
  description: 'Progression-based educational drip. Sends the next undelivered educational email; advances only on delivery.',
  enabled: EDUCATIONAL.length > 0,
  priority: 'low',
  order: 1000,
  category: 'lifecycle',
  trigger: 'scheduled',
  subject: () => '', // unused — resolve() provides the subject per recipient
  template: () => null as never, // unused — resolve() provides the template per recipient
  audience: lifecycleOwners,
  resolve: resolveNextEducational,
}

export const AUTOMATIONS: Automation[] = [
  welcome,
  cardTrialStarted,
  cardTrialChargeReminder,
  ...EVENT_CONTENT.map(contentToAutomation),
  ...STATE_CONTENT.map(contentToAutomation),
  educationalJourney,
]
