/**
 * Grow's documented token-charge error table ("פירוט שגיאות אופציונליות לחיוב
 * טוקן לא תקין", reference/token). Grow labels each row סופי (final) or לא סופי
 * (retryable); Grow's guidance on a final error is to stop charging the token.
 *
 * Matching is by the documented MESSAGE because id 103 appears as both final
 * ("כרטיס פג תוקף") and retryable ("חברת האשראי לא אשרה את העסקה"). Ids
 * 451/452/453 appear only as final rows, so they are final even if reworded.
 * Anything outside the table is 'unknown' — this module never guesses.
 */

export type TokenErrorClass = 'final' | 'retryable' | 'unknown'

const normalize = (message: string) => message.trim().replace(/\.+$/, '').trim()

const DOCUMENTED_MESSAGES: ReadonlyMap<string, Exclude<TokenErrorClass, 'unknown'>> = new Map([
  ['כרטיס פג תוקף', 'final'],
  ['כרטיס גנוב - עסקה לא מאושרת', 'final'],
  ['כרטיס חסום - עסקה לא מאושרת', 'final'],
  ['חברת האשראי לא אשרה את העסקה', 'retryable'],
  ['כרטיס האשראי אינו פעיל/פג תוקף, נא לפנות ללקוח לקבלת כרטיס חדש', 'final'],
  ['חסימת מערכת', 'final'],
  ['חברת האשראי חסמה את הכרטיס, נא לפנות ללקוח לבדיקה', 'final'],
])

const FINAL_ONLY_IDS = new Set([451, 452, 453])

export function classifyTokenChargeError(errorId: number | null, message: string): TokenErrorClass {
  const documented = DOCUMENTED_MESSAGES.get(normalize(message))
  if (documented) return documented
  if (errorId !== null && FINAL_ONLY_IDS.has(errorId)) return 'final'
  return 'unknown'
}
