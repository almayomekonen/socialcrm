import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import { dealBranchLabel } from '@/lib/deals/labels'

/**
 * Performance report tables (`GeneralTable`): the SQL returns Hebrew column
 * ALIASES as response keys (`db/helpers/sum_helpers.ts`, `db/sumSales.ts`), which
 * must never be renamed (do-not-touch §3). The header is labelled by that key for
 * display only; Hebrew shows the key itself, as before.
 */
const NAME_COLUMN: Record<string, MessageKey> = {
  נציג: 'performance.report.column.rep',
  חודש: 'performance.report.column.month',
  צוות: 'performance.report.column.team',
  חברה: 'performance.report.column.company',
}

export function reportColumnLabel(key: string, locale: UiLocale): string | null {
  if (NAME_COLUMN[key]) return translatorFor(locale)(NAME_COLUMN[key])
  const branch = dealBranchLabel(key, locale)
  return branch === key ? null : branch
}
