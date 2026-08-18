/**
 * Deterministic guard against unsupported business inferences.
 * These phrases imply conversion probability, heat, or outcome that the
 * CRM facts bundle never contains.
 */
const BANNED = [
  'סיכוי גבוה',
  'סיכוי גבוה למימוש',
  'סיכוי גבוה לסגירה',
  'לקוח חם',
  'ליד חם',
  'העסקה קרובה',
  'יגדיל המרות',
  'יגדיל מכירות',
  'ימנע אובדן',
  'ימנע המשך התדרדרות',
  'דורש טיפול מיידי',
  'פוטנציאל גבוה',
  'פוטנציאל עבודה שטרם מוצה',
  'טיפול מיידי מונע',
  'high probability',
  'high probability of closing',
  'hot lead',
  'will increase conversions',
  'increase conversions',
  'מפסיד כסף',
  'מאבד כסף',
  'המרה נמוכה',
  'יגדיל הכנסות',
  'הליד קר',
  'אתה מפסיד כסף',
]

export function containsUnsupportedBusinessClaim(text: string | null | undefined): boolean {
  if (!text) return false
  const t = text.toLowerCase()
  return BANNED.some((p) => t.includes(p.toLowerCase()))
}
