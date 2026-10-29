/**
 * Table dialogs, confirmations, delete results and the toasts that follow
 * table actions. Hebrew copied verbatim (Phase C).
 */
export const dialog = {
  leadDetails: 'פרטי ליד',
  bulkAssign: 'שיוך לידים לנציג',
  assignOne: 'שיוך ליד לנציג',
  upload: 'העלאת לידים',
  deal: 'טופס עסקה',
  bulkDeleteLeads: { other: 'למחוק {count} לידים?' },
  bulkDeleteCustomers: { other: 'למחוק {count} לקוחות?' },
  deleteLead: 'האם למחוק ליד {name}?',
  deleted: 'הליד נמחק',
  newArrived: { one: 'ליד חדש הגיע', other: '{count} לידים חדשים הגיעו' },
} as const

/** Single-lead delete refusals, by the server's `reason` code. */
export const deleteError = {
  noPermission: 'אין לך הרשאה למחוק ליד זה',
  notFound: 'הליד לא נמצא או כבר נמחק',
  hasBilling: 'לא ניתן למחוק — {reason}',
  billingLinked: 'הליד מקושר למערכת החיובים',
  generic: 'שגיאה במחיקת הליד',
} as const

/** Batch delete results (`lib/leads/deleteResult.ts`), by reason code. */
export const deleteResult = {
  reason: {
    billing_profile: 'קיים פרופיל חיוב פעיל',
    invoices: 'קיימות חשבוניות עבור הליד',
    financial_events: 'קיימות תנועות כספיות עבור הליד',
  },
  none: 'לא נמחקו לידים',
  allDeleted: { one: 'נמחק ליד אחד בהצלחה', other: 'נמחקו {count} לידים בהצלחה' },
  deleted: { one: 'נמחק ליד אחד', other: 'נמחקו {count} לידים' },
  blockedOne: 'ליד אחד לא נמחק כי {reason}',
  blockedMany: { other: '{count} לידים לא נמחקו כי קיימות עבורם רשומות חיוב' },
} as const

/** Bulk assign results. */
export const assignResult = {
  already: 'הלידים כבר משויכים לנציג הזה',
  partial: '{assigned} לידים שויכו. {skipped} כבר היו משויכים',
  done: { one: 'הליד שויך לנציג', other: '{count} לידים שויכו לנציג' },
} as const
