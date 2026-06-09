/**
 * Shared Hebrew labels for persisted conversation-intelligence values.
 * Used by the intelligence card, the conversation list rows and the toolbar —
 * display only, derived from stored analysis (no AI at render time).
 * Unknown values ('other', 'none', null) intentionally have no label and are hidden.
 */

export const INTENT_LABELS: Record<string, string> = {
  pricing: 'מתעניין במחיר',
  demo: 'מבקש הדגמה',
  signup: 'רוצה להצטרף',
  support: 'בקשת שירות',
  followup: 'המשך טיפול',
  information: 'מבקש מידע',
}

export const TEMPERATURE_BADGES: Record<string, { label: string; cls: string }> = {
  hot: { label: 'ליד חם', cls: 'bg-red-100 text-red-700' },
  warm: { label: 'ליד פושר', cls: 'bg-amber-100 text-amber-700' },
  cold: { label: 'ליד קר', cls: 'bg-blue-100 text-blue-700' },
}

export const ACTION_LABELS: Record<string, string> = {
  send_quote: 'שלח הצעת מחיר',
  schedule_demo: 'קבע הדגמה',
  follow_up: 'שלח הודעת המשך',
  answer_question: 'ענה לשאלת הליד',
  close_lead: 'התקדם לסגירה',
  escalate_support: 'העבר לטיפול שירות',
}

export const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'ביטחון גבוה',
  medium: 'ביטחון בינוני',
  low: 'ביטחון נמוך',
}
