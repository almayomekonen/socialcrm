'use client'

import { useCallback, useMemo } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { UiLocale } from '@/lib/i18n/config'
import { columnLabel, type LeadColumn } from './headers'

/**
 * Column headers in the interface language, WITHOUT touching what is stored.
 *
 * `user.tblPref[tblId]` persists each column object including its Hebrew
 * `label` (and older saves carry older labels). The table keeps that stored
 * shape as its state and saves it unchanged; only the copy handed to the
 * generic table for DISPLAY carries a translated label, looked up by column
 * KEY (an unknown key keeps its stored label).
 *
 * Hebrew is the identity: the stored objects themselves are displayed, edited
 * and saved, exactly as before i18n — including the stored label, which is
 * what a Hebrew user has always seen.
 *
 * In another language, edits made through the displayed copies (show/hide,
 * drag to reorder) are mapped back onto the stored objects by key before they
 * reach `setColumns` / `save`, so a translated label is never persisted.
 *
 * `labelFor` names another table's headers by key (the lead tasks and files
 * tabs); it defaults to the leads table's.
 */
export function useLocalizedColumns(
  columns: LeadColumn[],
  setColumns: (next: LeadColumn[]) => void,
  save: (next: LeadColumn[]) => void,
  labelFor: (key: string, locale: UiLocale) => string | null = columnLabel,
) {
  const t = useT()
  const locale = t.locale

  const display = useMemo(
    () =>
      locale === 'he' ? columns : columns.map((c) => ({ ...c, label: labelFor(c.key, locale) ?? c.label })),
    [columns, locale, labelFor],
  )

  const toStored = useCallback(
    (next: LeadColumn[]): LeadColumn[] => {
      if (locale === 'he') return next
      const byKey = new Map(columns.map((c) => [c.key, c]))
      return next.map((n) => {
        const stored = byKey.get(n.key)
        if (!stored) return n
        return Boolean(n.noShow) === Boolean(stored.noShow) ? stored : { ...stored, noShow: n.noShow }
      })
    },
    [columns, locale],
  )

  return {
    columns: display,
    setColumns: (next: LeadColumn[]) => setColumns(toStored(next)),
    save: (next: LeadColumn[]) => save(toStored(next)),
  }
}
