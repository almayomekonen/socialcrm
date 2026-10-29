/** Column definitions for the leads / clients table, and the saved-preference merge. */

export type LeadColumn = { key: string; label: string; format?: string; noShow?: boolean }

export function getHeaders(leads, hasMultipleUsers = true) {
  const headers = [
    { key: 'name', label: 'שם מלא', format: 'formatName' },
    { key: 'phone', label: 'מספר טלפון' },
    { key: 'status', label: 'סטטוס', format: 'formatStatus' },
    { key: 'nextAction', label: 'פעולה הבאה', format: 'formatNextAction' },
    { key: 'leadSource', label: 'מקור', format: 'formatLeadSource' },
    ...(hasMultipleUsers
      ? [
          { key: 'userName', label: 'בעל הליד' },
          { key: 'handlerName', label: 'אחראי נוסף (לא חובה)' },
        ]
      : []),
    { key: 'email', label: 'מייל' },
    // Optional, opt-in columns — hidden by default (noShow), available via the Columns selector.
    { key: 'idNum', label: 'תעודת זהות', noShow: true },
    { key: 'secPhone', label: 'טלפון נוסף', noShow: true },
    { key: 'birthDate', label: 'תאריך לידה', format: 'formatDate', noShow: true },
    { key: 'gender', label: 'מין', noShow: true },
  ]
  if (leads) {
    headers.push(
      { key: 'leadStatus', label: 'מצב ליד', format: 'formatLeadStatus' },
    )
  }
  headers.push({ key: 'lastContact', label: 'מגע אחרון', format: 'formatLastContact' })
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
