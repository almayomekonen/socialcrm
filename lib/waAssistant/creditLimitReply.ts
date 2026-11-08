import 'server-only'
import { db } from '@/config/db'
import { creditPurchaseUrl } from '@/lib/credits/purchaseLink'
import { monthlyAllowance } from '@/lib/credits/config'
import type { CreditNotice } from '@/db/credits/agentRequests'

/**
 * The transactional reply to an owner's own request that the free allowance no
 * longer covers. Never names a cost, a token or a provider.
 */
export function creditLimitText(notice: Exclude<CreditNotice, null>, locale: 'he' | 'en', limit: number, url: string): string {
  if (locale === 'en') {
    return notice === 'full'
      ? `You have used the ${limit} smart-assistant requests included in your account this month, so I did not run this one.\nTo continue, add credits here:\n${url}\nYou are charged only after you confirm on that page, and it does not renew. The CRM and your reminders keep working as usual.`
      : `To continue, add credits here:\n${url}`
  }
  return notice === 'full'
    ? `השתמשתם ב-${limit} הבקשות לעוזר החכם שכלולות בחשבון החודש, ולכן לא ביצעתי את הבקשה הזו.\nכדי להמשיך צריך קרדיטים נוספים. אפשר להוסיף אותם כאן:\n${url}\nהחיוב מתבצע רק אחרי אישור בעמוד הרכישה, והוא לא מתחדש. ה-CRM והתזכורות ממשיכים לעבוד כרגיל.`
    : `כדי להמשיך צריך קרדיטים נוספים:\n${url}`
}

export async function creditLimitReply(agencyId: number, notice: CreditNotice): Promise<string | null> {
  if (!notice) return null
  const row = (await db('agencies').where({ id: agencyId }).first('uiLocale')) as { uiLocale: string | null } | undefined
  return creditLimitText(notice, row?.uiLocale === 'en' ? 'en' : 'he', monthlyAllowance(), creditPurchaseUrl(agencyId))
}
