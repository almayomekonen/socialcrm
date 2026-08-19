/**
 * Deterministic business reasoning over the six CRM counts.
 * Pattern: useful FACT → INTERPRETATION → PRIORITY → ONE ACTION.
 * Never invents revenue, conversion, probability, heat, or capacity.
 */
import { containsUnsupportedBusinessClaim } from './unsupportedClaims'

export type GrowthCounts = {
  overdueTasks: number
  dueToday: number
  staleLeads: number
  waitingConversations: number
  newLeads: number
  meetingsToday: number
}

export type BusinessAdviceKind = 'state' | 'advice' | 'see' | 'leak'

const STATE_PHRASES = ['מה מצב העסק', 'מה קורה בעסק', 'מצב העסק']
const ADVICE_PHRASES = [
  'לקדם את העסק',
  'מקדם את העסק',
  'להרוויח כסף',
  'להרוויח',
  'מגדיל מכירות',
  'להגדיל מכירות',
  'מגדיל הכנסות',
  'להגדיל הכנסות',
  'כדי לגדול',
  'מה הייתי עושה במקומי',
  'במקומי',
  'על מה כדאי לי להתמקד',
  'מה כדאי לי לעשות',
  'מה הכי חשוב עכשיו',
  'אם היית מנהל את העסק',
  'increase sales',
  'grow the business',
  'make money',
]
const SEE_PHRASES = [
  'מה אתה רואה',
  'מה אני רואה',
  'מדאיג אותך',
  'מפספס',
  'הבעיה שלי',
  'מה לדעתך הבעיה',
]
const LEAK_PHRASES = ['מפסיד לידים', 'איפה אני מפסיד', 'נופלים לידים']

export function classifyBusinessAdvice(text: string): BusinessAdviceKind | null {
  const t = text.trim().toLowerCase()
  if (LEAK_PHRASES.some((p) => t.includes(p))) return 'leak'
  if (SEE_PHRASES.some((p) => t.includes(p))) return 'see'
  if (ADVICE_PHRASES.some((p) => t.includes(p))) return 'advice'
  if (STATE_PHRASES.some((p) => t.includes(p))) return 'state'
  return null
}

const HONEST_LIMIT = 'אין לי נתוני הכנסה, סגירות או המרה, אז אני לא ממציא כמה כסף זה שווה.'
const INSUFFICIENT = 'אני לא יכול לקבוע את זה מהנתונים שיש לי כרגע.'
const ALL_CLEAR =
  'אין כרגע צוואר בקבוק ברור ב-CRM לפי שיחות ממתינות, משימות באיחור, מעקבים או לידים שלא היו בקשר.'

type Pattern = 'response' | 'followup' | 'task' | 'inflow' | 'all_clear'
type Priority = 'waiting' | 'overdue' | 'dueToday' | 'stale' | 'newLeads' | 'meetings' | null

function patternOf(c: GrowthCounts): Pattern {
  if (c.waitingConversations > 0) return 'response'
  if (c.overdueTasks > 0 || c.dueToday > 0) return 'task'
  if (c.staleLeads > 0) return 'followup'
  if (c.newLeads > 0) return 'inflow'
  return 'all_clear'
}

function priorityOf(c: GrowthCounts): Priority {
  if (c.waitingConversations > 0) return 'waiting'
  if (c.overdueTasks > 0) return 'overdue'
  if (c.dueToday > 0) return 'dueToday'
  if (c.staleLeads > 0) return 'stale'
  if (c.newLeads > 0) return 'newLeads'
  if (c.meetingsToday > 0) return 'meetings'
  return null
}

function waitingFact(n: number): string {
  return n === 1 ? 'יש 1 שיחה שממתינה למענה' : `יש ${n} שיחות שממתינות למענה`
}

function factsFor(c: GrowthCounts, pattern: Pattern): string[] {
  if (pattern === 'response') {
    const facts = [waitingFact(c.waitingConversations)]
    if (c.overdueTasks > 0) facts.push(`יש ${c.overdueTasks} משימות שעבר מועד הטיפול שלהן`)
    if (c.staleLeads > 0 && facts.length < 3) facts.push(`יש ${c.staleLeads} לידים שלא היו בקשר`)
    if (c.newLeads > 0 && facts.length < 3) facts.push(`במקביל נכנסו ${c.newLeads} לידים חדשים השבוע`)
    return facts
  }
  if (pattern === 'followup') {
    const facts = [`יש ${c.staleLeads} לידים שלא היו בקשר לאחרונה`]
    if (c.newLeads > 0) facts.push(`במקביל נכנסו ${c.newLeads} לידים חדשים השבוע`)
    return facts
  }
  if (pattern === 'task') {
    const facts: string[] = []
    if (c.overdueTasks > 0) facts.push(`יש ${c.overdueTasks} משימות שעבר מועד הטיפול שלהן`)
    if (c.dueToday > 0) facts.push(`יש ${c.dueToday} מעקבים שמתוזמנים להיום`)
    if (c.staleLeads > 0) facts.push(`יש ${c.staleLeads} לידים שלא היו בקשר`)
    return facts
  }
  if (pattern === 'inflow') return [`השבוע נכנסו ${c.newLeads} לידים חדשים ל-CRM`]
  if (c.meetingsToday > 0) return [`יש ${c.meetingsToday} פגישות ביומן להיום`]
  return []
}

function interpretation(c: GrowthCounts, pattern: Pattern): string | null {
  if (pattern === 'response') {
    const demand = 'יש ביקוש שנכנס בוואטסאפ ועדיין לא קיבל מענה אנושי.'
    if (c.newLeads > 0 && c.staleLeads > 0) {
      return `${demand} נכנסת עבודה חדשה בזמן שעבודה קיימת עדיין ממתינה לטיפול.`
    }
    return demand
  }
  if (pattern === 'followup') {
    if (c.newLeads > 0) return 'נכנסים לידים חדשים, אבל חלק מהלידים שכבר במערכת לא קיבלו המשך.'
    return 'עיקר העבודה כרגע היא לחזור ללידים שכבר נמצאים במערכת ולא קיבלו פעילות לאחרונה.'
  }
  if (pattern === 'task') return 'יש כרגע עבודה פתוחה ב-CRM שעדיין דורשת טיפול.'
  if (pattern === 'inflow') {
    return 'אין כרגע צוואר בקבוק ברור במענה, במשימות או במעקב לפי הנתונים שאני רואה.'
  }
  return null
}

function bottleneck(c: GrowthCounts, pattern: Pattern): string | null {
  if (pattern === 'response') return 'כרגע נראה שצוואר הבקבוק הוא בטיפול בעבודה שכבר נכנסה.'
  if (pattern === 'followup') {
    return 'כרגע צוואר הבקבוק נראה כמו מעקב אחרי לידים שכבר נמצאים במערכת.'
  }
  if (pattern === 'all_clear' || pattern === 'inflow') return ALL_CLEAR
  return null
}

function actionLine(c: GrowthCounts, priority: Priority): string | null {
  if (priority === 'waiting') {
    const first =
      c.waitingConversations === 1
        ? 'הייתי מתמקד קודם בשיחה שממתינה למענה'
        : `הייתי מתמקד קודם ב-${c.waitingConversations} השיחות שממתינות למענה`
    const nextIsStale = c.overdueTasks === 0 && c.dueToday === 0 && c.staleLeads > 0
    return nextIsStale ? `${first}, ורק אחר כך עובר ללידים שלא היו בקשר.` : `${first}.`
  }
  if (priority === 'overdue') return 'הייתי מתמקד קודם במשימות שעבר מועד הטיפול שלהן.'
  if (priority === 'dueToday') return 'הייתי מתמקד קודם במעקבים שמתוזמנים להיום.'
  if (priority === 'stale') {
    return 'הייתי מתמקד עכשיו בלידים שלא היו בקשר, ומתחיל מהוותיקים ביותר.'
  }
  if (priority === 'newLeads') return 'הייתי מתמקד כרגע בטיפול מסודר בלידים החדשים.'
  return null
}

function joinFacts(facts: string[]): string {
  if (facts.length === 0) return ''
  if (facts.length === 1) return facts[0] + '.'
  const last = facts[facts.length - 1]
  const alreadyParallel = last.startsWith('במקביל ')
  const head = facts.slice(0, -1).join(', ')
  return alreadyParallel ? `${head}, ${last}.` : `${head}, ו${last}.`
}

function body(c: GrowthCounts): { opening: string; middle: string | null; action: string | null } {
  const pattern = patternOf(c)
  const facts = joinFacts(factsFor(c, pattern))
  const neck = bottleneck(c, pattern)
  const read = interpretation(c, pattern)
  const opening =
    pattern === 'inflow'
      ? `${facts} ${read}`
      : pattern === 'all_clear'
        ? neck && facts
          ? `${neck} ${facts}`
          : (neck ?? facts)
        : [neck, facts].filter(Boolean).join(' ')
  return {
    opening,
    middle: pattern === 'inflow' || pattern === 'all_clear' ? null : read,
    action: actionLine(c, priorityOf(c)),
  }
}

function composeState(c: GrowthCounts): string {
  const { opening, middle, action } = body(c)
  return [opening, middle, action].filter(Boolean).join('\n\n')
}

function composeAdvice(c: GrowthCounts): string {
  const { opening, middle, action } = body(c)
  return [opening, middle, action, HONEST_LIMIT].filter(Boolean).join('\n\n')
}

function composeSee(c: GrowthCounts): string {
  const { opening, middle, action } = body(c)
  const head = `מה שאני רואה כרגע: ${opening}`
  return [head, middle, action].filter(Boolean).join('\n\n')
}

function composeLeak(c: GrowthCounts): string {
  const leak = c.waitingConversations > 0 || c.staleLeads > 0 || c.overdueTasks > 0
  if (!leak) {
    return `${INSUFFICIENT} אין לי מספרי סגירה, המרה או לידים שסומנו כאבודים — אז אני לא יכול להגיד שאתה מפסיד לידים.`
  }
  const { opening, middle, action } = body(c)
  return [opening, middle, action, HONEST_LIMIT].filter(Boolean).join('\n\n')
}

export function composeBusinessAdvice(kind: BusinessAdviceKind, c: GrowthCounts): string {
  let text: string
  switch (kind) {
    case 'state':
      text = composeState(c)
      break
    case 'advice':
      text = composeAdvice(c)
      break
    case 'see':
      text = composeSee(c)
      break
    case 'leak':
      text = composeLeak(c)
      break
  }
  return containsUnsupportedBusinessClaim(text) ? `${INSUFFICIENT} ${HONEST_LIMIT}` : text
}
