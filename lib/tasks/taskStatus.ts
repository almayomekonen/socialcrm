import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * Task status DISPLAY labels, keyed by the STORED value.
 *
 * `tasks.status` stores these Hebrew words (the options of
 * `SelectTasksStatus`), filters compare them, and `updateFullTask` writes
 * them — they are data and never change. Only what a user reads is looked up
 * here; Hebrew returns the stored word itself (`leadTabs.tasks.status.*` copies
 * it verbatim). Framework-neutral: no `'use client'`, no JSX.
 */
const TASK_STATUS_KEY: Record<string, MessageKey> = {
  חדש: 'leadTabs.tasks.status.new',
  בטיפול: 'leadTabs.tasks.status.inProgress',
  'ממתין לתשובה': 'leadTabs.tasks.status.awaitingReply',
  'הועבר לנציג אחר': 'leadTabs.tasks.status.reassigned',
  'לא רלוונטי': 'leadTabs.tasks.status.notRelevant',
  'לא מעוניין': 'leadTabs.tasks.status.notInterested',
  סגורה: 'leadTabs.tasks.status.closed',
  'הסתיים טיפול': 'leadTabs.tasks.status.handled',
}

/** Label of a stored task status; an unknown or empty value is shown as stored. */
export function taskStatusLabel<T>(stored: T, locale: UiLocale = 'he'): T | string {
  const key = typeof stored === 'string' ? TASK_STATUS_KEY[stored] : undefined
  return key ? translatorFor(locale)(key) : stored
}

/**
 * Picker options for the stored statuses. Hebrew returns the stored strings
 * themselves (the exact array the pickers always received); other languages
 * get `{ id: stored, name: label }`, so the picked `id` is still the stored value.
 */
export function taskStatusOptions(values: readonly string[], locale: UiLocale = 'he'): (string | { id: string; name: string })[] {
  if (locale === 'he') return [...values]
  return values.map((id) => ({ id, name: taskStatusLabel(id, locale) as string }))
}
