/** Column definitions for the leads / clients table, and the saved-preference merge. */

import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

export type LeadColumn = { key: string; label: string; format?: string; noShow?: boolean }

/** Header text by column KEY. `user.tblPref` stores its own `label`; display reads this map. */
const HEADER_KEY: Record<string, MessageKey> = {
  name: 'leads.table.header.name',
  phone: 'leads.table.header.phone',
  status: 'leads.table.header.status',
  nextAction: 'leads.table.header.nextAction',
  leadSource: 'leads.table.header.leadSource',
  userName: 'leads.table.header.userName',
  handlerName: 'leads.table.header.handlerName',
  email: 'leads.table.header.email',
  idNum: 'leads.table.header.idNum',
  secPhone: 'leads.table.header.secPhone',
  birthDate: 'leads.table.header.birthDate',
  gender: 'leads.table.header.gender',
  leadStatus: 'leads.table.header.leadStatus',
  lastContact: 'leads.table.header.lastContact',
}

/** The header for a column key in `locale`, or `null` for a key this table does not define. */
export function columnLabel(key: string, locale: UiLocale = 'he'): string | null {
  const k = HEADER_KEY[key]
  return k ? translatorFor(locale)(k) : null
}

export function getHeaders(leads, hasMultipleUsers = true, locale: UiLocale = 'he'): LeadColumn[] {
  const col = (key: string, extra: Omit<LeadColumn, 'key' | 'label'> = {}): LeadColumn => ({
    key,
    label: columnLabel(key, locale) as string,
    ...extra,
  })
  const headers = [
    col('name', { format: 'formatName' }),
    col('phone'),
    col('status', { format: 'formatStatus' }),
    col('nextAction', { format: 'formatNextAction' }),
    col('leadSource', { format: 'formatLeadSource' }),
    ...(hasMultipleUsers ? [col('userName'), col('handlerName')] : []),
    col('email'),
    // Optional, opt-in columns — hidden by default (noShow), available via the Columns selector.
    col('idNum', { noShow: true }),
    col('secPhone', { noShow: true }),
    col('birthDate', { format: 'formatDate', noShow: true }),
    col('gender', { noShow: true }),
  ]
  if (leads) {
    headers.push(col('leadStatus', { format: 'formatLeadStatus' }))
  }
  headers.push(col('lastContact', { format: 'formatLastContact' }))
  return headers
}

/**
 * The user's saved column order (`user.tblPref[tblId]`, stored as-is) with
 * columns that no longer exist dropped and newly added ones appended.
 */
export function initialColumns(user, tblId: string, validHeaders: LeadColumn[]) {
  const validKeys = new Set(validHeaders.map((h) => h.key))
  const savedPref = user?.tblPref?.[tblId]?.filter((col) => validKeys.has(col.key))
  const savedKeys = new Set(savedPref?.map((c) => c.key) || [])
  const missingFromPref = validHeaders.filter((h) => !savedKeys.has(h.key))
  return savedPref?.length ? [...savedPref, ...missingFromPref] : validHeaders
}
