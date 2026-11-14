import type { Automation, Recipient, ResolvedSend } from './types'
import type { ContentItem } from './content/types'
import { renderContentItem } from './contentToAutomation'
import { creditPeriodKey } from '@/db/credits/ledger'
import { monthlyAllowance } from '@/lib/credits/config'

/**
 * The owner's one notice that paid AI stopped this month.
 *
 * Sent when the FIRST request of the credit month is refused for lack of
 * allowance and credits (db/credits/agentRequests.ts, notice 'full'), whichever
 * surface it came from. It matters most for the customer-facing WhatsApp agent:
 * that refusal happens in a background job, with no owner on screen to read an
 * inline message, and the customer's message waits for a human.
 *
 * At most once per agency per credit month: the send key carries the month.
 * It says what stopped, what keeps working, and where to add credits — never a
 * cost, a token count or a provider.
 */

const BILLING_ROUTE = '/settings/update_payment'

function content(): ContentItem {
  return {
    key: 'credits_exhausted',
    category: 'transactional',
    topic: 'activation',
    schedule: { kind: 'event', event: 'credits.exhausted' },
    priority: 'high',
    greet: true,
    subject: 'נוצלו בקשות ה-AI הכלולות החודש',
    preview: 'אפשר להוסיף קרדיטים כדי להמשיך',
    headline: 'פעולות ה-AI מושהות עד להוספת קרדיטים',
    blocks: [
      { type: 'paragraph', text: `נוצלו ${monthlyAllowance()} בקשות ה-AI הכלולות במנוי החודש, ואין קרדיטים נוספים בחשבון.` },
      { type: 'paragraph', text: 'עד שיתווספו קרדיטים, העוזר החכם והמענה האוטומטי בוואטסאפ לא יפעלו. הודעות חדשות מלקוחות נשמרות בתיבת ההודעות ומחכות למענה שלכם.' },
      { type: 'paragraph', text: 'ה-CRM, הלידים, תיבת ההודעות והמענה הידני ממשיכים לעבוד כרגיל.' },
    ],
    cta: { label: 'הוספת קרדיטים', route: BILLING_ROUTE },
  }
}

async function resolveExhausted(r: Recipient): Promise<ResolvedSend | null> {
  const c = content()
  return {
    key: `${c.key}:${creditPeriodKey(Date.now())}`,
    subject: c.subject,
    template: renderContentItem(c, r),
  }
}

export const creditsExhausted: Automation = {
  key: 'credits_exhausted',
  description: 'The first AI request of the credit month was refused (allowance and credits used up): says what paused and links to buying credits. Once per agency per month.',
  enabled: true,
  priority: 'high',
  order: 0,
  category: 'transactional',
  trigger: 'event',
  event: 'credits.exhausted',
  subject: () => 'נוצלו בקשות ה-AI הכלולות החודש',
  template: () => null as never, // resolve() renders per recipient
  resolve: resolveExhausted,
}
