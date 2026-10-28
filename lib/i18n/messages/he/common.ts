/**
 * Shared defaults used across the product. The Hebrew values are the exact
 * strings `Btn` and `lib/toast.tsx` rendered before i18n (asserted in
 * __tests__/i18n/sharedDefaults.test.tsx).
 */
export const common = {
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
