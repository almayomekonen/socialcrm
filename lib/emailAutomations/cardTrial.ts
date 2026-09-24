import type { Automation, Recipient, ResolvedSend } from './types'
import type { ContentItem } from './content/types'
import { renderContentItem } from './contentToAutomation'
import { ownersCardTrialChargeSoon } from './recipients'
import { agencyFirstChargeAt } from '@/db/payments/cardTrialEmails'
import { CARD_TRIAL_AMOUNT, CARD_TRIAL_PERIOD } from '@/lib/payments/cardTrial/terms'
import { formatBillingDate } from '@/lib/payments/cardTrial/firstCharge'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'

/**
 * The two card-trial emails. They are dynamic automations rather than static
 * content items because both must state the EXACT first-charge date, and that
 * date comes from the agency's persisted trial end — the same value the billing
 * page shows (lib/payments/cardTrial/firstCharge.ts).
 *
 * Neither may reach a click-to-start (no-card) trial: `trial.card_started` is
 * dispatched only by the verified Grow callback, and the reminder's audience
 * requires an active card. The no-card wording lives in `trial_started` /
 * `trial_ending`, whose audience now excludes card-billed agencies.
 */

const BILLING_ROUTE = '/settings/update_payment'

function startedContent(chargeDate: string): ContentItem {
  return {
    key: 'card_trial_started',
    category: 'transactional',
    topic: 'activation',
    schedule: { kind: 'event', event: 'trial.card_started' },
    priority: 'high',
    greet: true,
    subject: `תקופת הניסיון שלך ב־SocialCRM Pro התחילה`,
    preview: `${TRIAL_LENGTH_DAYS} ימים ללא עלות. הכרטיס נשמר ולא חויב`,
    headline: 'הניסיון שלך פעיל — הכרטיס נשמר ולא חויב',
    blocks: [
      { type: 'paragraph', text: `${TRIAL_LENGTH_DAYS} ימי הניסיון התחילו עכשיו, וכל יכולות ה־Pro פתוחות עבורך.` },
      { type: 'paragraph', text: `הכרטיס ששמרת לא חויב. החיוב הראשון, ₪${CARD_TRIAL_AMOUNT}, יתבצע ב־${chargeDate}, ולאחר מכן מדי חודש.` },
      { type: 'paragraph', text: 'אפשר לבטל בכל רגע לפני התאריך הזה בעמוד המנוי, ואז לא יבוצע חיוב.' },
    ],
    cta: { label: 'לעמוד המנוי', route: BILLING_ROUTE },
  }
}

function reminderContent(chargeDate: string): ContentItem {
  return {
    key: 'card_trial_charge_reminder',
    category: 'transactional',
    topic: 'activation',
    schedule: { kind: 'condition' },
    priority: 'high',
    greet: true,
    subject: `תזכורת: החיוב החודשי מתחיל ב־${chargeDate}`,
    preview: `₪${CARD_TRIAL_AMOUNT} לחודש בתום תקופת הניסיון`,
    headline: 'עוד יומיים מתחיל המנוי בתשלום',
    blocks: [
      { type: 'paragraph', text: `ב־${chargeDate} תסתיים תקופת הניסיון ונחייב את הכרטיס ששמרת ב־₪${CARD_TRIAL_AMOUNT}, ולאחר מכן מדי חודש.` },
      { type: 'paragraph', text: 'אם תרצה להמשיך — אין צורך לעשות דבר.' },
      { type: 'paragraph', text: 'אם לא, אפשר לבטל בעמוד המנוי לפני התאריך הזה ולא יבוצע חיוב.' },
    ],
    cta: { label: 'לעמוד המנוי', route: BILLING_ROUTE },
  }
}

async function resolveWithChargeDate(item: (chargeDate: string) => ContentItem, r: Recipient): Promise<ResolvedSend | null> {
  const chargeAt = await agencyFirstChargeAt(r.agencyId)
  if (!chargeAt) return null
  const content = item(formatBillingDate(chargeAt))
  return { key: content.key, subject: content.subject, template: renderContentItem(content, r) }
}

/** Sent by the verified Grow callback — never by the click-to-start path. */
export const cardTrialStarted: Automation = {
  key: 'card_trial_started',
  description: `Card-required trial activated: the card was saved and not charged; states the exact first-charge date. ${CARD_TRIAL_PERIOD} billing.`,
  enabled: true,
  priority: 'high',
  order: 0,
  category: 'transactional',
  trigger: 'event',
  event: 'trial.card_started',
  subject: () => 'תקופת הניסיון שלך ב־SocialCRM Pro התחילה',
  template: () => null as never, // resolve() renders per recipient (exact date)
  resolve: (r) => resolveWithChargeDate(startedContent, r),
}

/**
 * ~2 days before the first charge (owner decision 2026-09-15). Deduplicated
 * once per user by the send key; the audience is empty while token charges are
 * disabled (never promise a charge that cannot happen) and excludes
 * cancellations, agencies whose charge date has already passed, and anything
 * already settled, so a late pass cannot send "in two days" after the fact.
 */
export const cardTrialChargeReminder: Automation = {
  key: 'card_trial_charge_reminder',
  description: 'Reminder ~2 days before the first token charge, with the exact date from the persisted trial end.',
  enabled: true,
  priority: 'high',
  order: 0,
  category: 'transactional',
  trigger: 'scheduled',
  audience: ownersCardTrialChargeSoon,
  subject: () => 'תזכורת לפני תחילת החיוב החודשי',
  template: () => null as never, // resolve() renders per recipient (exact date)
  resolve: (r) => resolveWithChargeDate(reminderContent, r),
}
