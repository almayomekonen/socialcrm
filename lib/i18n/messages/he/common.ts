/**
 * Shared defaults used across the product. The Hebrew values are the exact
 * strings `Btn` and `lib/toast.tsx` rendered before i18n (asserted in
 * __tests__/i18n/sharedDefaults.test.tsx).
 */
export const common = {
  /** Lead-source channel labels (lib/leads/leadSourceLabel.ts). Brand names stay in Latin script where the brand does. */
  source: { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram', website: 'אתר', manual: 'ידני' },
  save: 'שמירה',
  toast: {
    success: 'בוצע בהצלחה!',
    error: 'אירעה שגיאה!',
    loading: 'טוען...',
    ban: 'אינך מורשה',
    message: 'הודעה חדשה',
    pro: 'הפעולה זמינה עם Pro',
  },
} as const
