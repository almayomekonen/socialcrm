import type { Automation, Recipient, ResolvedSend } from './types'
import type { ContentItem } from './content/types'
import { renderContentItem } from './contentToAutomation'
import { agencyChargeFailure, type ChargeFailureNotice } from '@/db/payments/cardTrialEmails'
import { CARD_TRIAL_AMOUNT } from '@/lib/payments/cardTrial/terms'
import { formatBillingDate } from '@/lib/payments/cardTrial/firstCharge'

/**
 * What a card-billed customer hears when a charge does not go through.
 *
 * At most TWO emails per billing period, never one per attempt: the first
 * failure (which names the retry date, so the customer knows nothing is lost
 * yet) and the final one (no attempt left — the card has to be replaced). The
 * send key carries the period, so the next month starts the count again while a
 * retry inside the same month cannot re-send.
 *
 * It says what happened and what to do, and nothing else. No count of missed
 * payments, no warning about what we will take away — a failed card is usually
 * an expired card, not a decision.
 *
 * An `unknown` outcome is never announced. Until reconciliation says otherwise
 * we do not know that anything failed, and telling someone their payment failed
 * when it may have succeeded is the one mistake this email cannot make.
 */

const BILLING_ROUTE = '/settings/update_payment'

function failedContent(notice: ChargeFailureNotice): ContentItem {
  const retryDate = notice.nextAttemptAt ? formatBillingDate(notice.nextAttemptAt) : null

  const blocks: ContentItem['blocks'] = [
    { type: 'paragraph', text: `לא הצלחנו לחייב את הכרטיס השמור בסכום של ₪${CARD_TRIAL_AMOUNT}.` },
  ]
  if (notice.final) {
    blocks.push({ type: 'paragraph', text: 'זה היה הניסיון האחרון, ולכן המנוי לא יתחדש עד שיעודכן כרטיס.' })
    blocks.push({ type: 'paragraph', text: 'אפשר לעדכן כרטיס בעמוד המנוי, והחיוב יתבצע מיד לאחר מכן.' })
  } else if (retryDate) {
    blocks.push({ type: 'paragraph', text: `ננסה שוב באופן אוטומטי ב־${retryDate}. אין צורך לעשות דבר אם הכרטיס תקין.` })
    blocks.push({ type: 'paragraph', text: 'אם הכרטיס פג תוקף או הוחלף, אפשר לעדכן אותו עכשיו בעמוד המנוי.' })
  } else {
    blocks.push({ type: 'paragraph', text: 'אפשר לעדכן את פרטי הכרטיס בעמוד המנוי כדי להמשיך.' })
  }

  return {
    key: 'subscription_payment_failed',
    category: 'transactional',
    topic: 'activation',
    schedule: { kind: 'event', event: 'subscription.payment_failed' },
    priority: 'high',
    greet: true,
    subject: 'לא הצלחנו לחייב את הכרטיס',
    preview: notice.final ? 'יש לעדכן כרטיס כדי להמשיך' : 'ננסה שוב אוטומטית',
    headline: 'החיוב לא עבר',
    blocks,
    cta: { label: 'עדכון כרטיס', route: BILLING_ROUTE },
  }
}

async function resolveFailure(r: Recipient): Promise<ResolvedSend | null> {
  const notice = await agencyChargeFailure(r.agencyId)
  if (!notice) return null
  const content = failedContent(notice)
  return {
    // One "we will retry" and one "this was the last attempt" per period.
    key: `${content.key}:${notice.periodKey}:${notice.final ? 'final' : 'first'}`,
    subject: content.subject,
    template: renderContentItem(content, r),
  }
}

export const subscriptionPaymentFailed: Automation = {
  key: 'subscription_payment_failed',
  description: 'A token charge was declined: names the automatic retry date, or asks for a new card once no attempt is left.',
  enabled: true,
  priority: 'high',
  order: 0,
  category: 'transactional',
  trigger: 'event',
  event: 'subscription.payment_failed',
  subject: () => 'לא הצלחנו לחייב את הכרטיס',
  template: () => null as never, // resolve() renders per recipient (retry date, finality)
  resolve: resolveFailure,
}
