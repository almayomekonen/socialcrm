import type { UiLocale } from '@/lib/i18n/config'
import { formatLeadDate } from '@/lib/leads/leadDate'

/**
 * A Drive file's "modified" date on the lead files tab. Hebrew keeps the exact
 * legacy text (the ISO day, `YYYY-MM-DD`); other interface languages format it
 * in the business timezone like every other lead date.
 */
export function driveModifiedDate(modifiedTime: string | null | undefined, locale: UiLocale): string {
  if (!modifiedTime) return ''
  return locale === 'he' ? modifiedTime.slice(0, 10) : formatLeadDate(locale, modifiedTime)
}
