import 'server-only'
import { db } from '@/config/db'
import { creditPurchaseUrl } from '@/lib/credits/purchaseLink'
import { monthlyAllowance } from '@/lib/credits/config'
import type { CreditNotice } from '@/db/credits/agentRequests'
import { isAdmin, type Roles } from '@/types/roles'

/**
 * The transactional reply to an owner's own request that the free allowance no
 * longer covers. Never names a cost, a token or a provider.
 */
export function creditLimitText(notice: Exclude<CreditNotice, null>, locale: 'he' | 'en', limit: number, url: string | null): string {
  if (locale === 'en') {
    const action = url ? `To continue, add credits here:\n${url}` : 'To continue, your account admin needs to add credits.'
    if (notice === 'short') return action
    return [`You have used the ${limit} smart-assistant requests included in your account this month, so I did not run this one.`, action, ...(url ? ['You are charged only after you confirm on that page, and it does not renew.'] : []), 'The CRM and your reminders keep working as usual.'].join('\n')
  }
  const action = url ? `כדי להמשיך צריך קרדיטים נוספים. אפשר להוסיף אותם כאן:\n${url}` : 'כדי להמשיך, מנהל החשבון צריך להוסיף קרדיטים.'
  if (notice === 'short') return action
  return [`השתמשתם ב-${limit} הבקשות לעוזר החכם שכלולות בחשבון החודש, ולכן לא ביצעתי את הבקשה הזו.`, action, ...(url ? ['החיוב מתבצע רק אחרי אישור בעמוד הרכישה, והוא לא מתחדש.'] : []), 'ה-CRM והתזכורות ממשיכים לעבוד כרגיל.'].join('\n')
}

/** The link goes only to someone who can use it: buying is an admin action. */
export async function creditLimitReply(agencyId: number, notice: CreditNotice, role: string): Promise<string | null> {
  if (!notice) return null
  const row = (await db('agencies').where({ id: agencyId }).first('uiLocale')) as { uiLocale: string | null } | undefined
  return creditLimitText(notice, row?.uiLocale === 'en' ? 'en' : 'he', monthlyAllowance(), isAdmin(role as Roles) ? creditPurchaseUrl(agencyId) : null)
}
