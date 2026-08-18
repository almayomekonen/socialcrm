/**
 * Deterministic business reasoning over CRM counts.
 * Layers: FACT → OBSERVATION → RECOMMENDATION → ACTION.
 * Never invents revenue, conversion, probability, or heat.
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

type Signal = {
  key: 'waiting' | 'overdue' | 'dueToday' | 'stale' | 'newLeads' | 'meetings'
  count: number
  fact: string
  observation: string
  action: string
}

function signals(c: GrowthCounts): Signal[] {
  const out: Signal[] = []
  if (c.waitingConversations > 0) {
    const n = c.waitingConversations
    out.push({
      key: 'waiting',
      count: n,
      fact: n === 1 ? 'יש 1 שיחה שממתינה למענה' : `יש ${n} שיחות שממתינות למענה`,
      observation: 'מישהו כבר כתב ועדיין לא קיבל תשובה.',
      action: 'לענות קודם לשיחות שממתינות למענה',
    })
  }
  if (c.overdueTasks > 0) {
    out.push({
      key: 'overdue',
      count: c.overdueTasks,
      fact: `יש ${c.overdueTasks} משימות באיחור`,
      observation: 'יש התחייבויות שכבר עברו את התאריך ב-CRM.',
      action: 'לסגור קודם את המשימות שבאיחור',
    })
  }
  if (c.dueToday > 0) {
    out.push({
      key: 'dueToday',
      count: c.dueToday,
      fact: `יש ${c.dueToday} מעקבים להיום`,
      observation: 'אלה מעקבים שכבר קבעת להיום.',
      action: 'לטפל במעקבים להיום',
    })
  }
  if (c.staleLeads > 0) {
    out.push({
      key: 'stale',
      count: c.staleLeads,
      fact: `יש ${c.staleLeads} לידים שלא היו בקשר`,
      observation:
        c.staleLeads >= 10
          ? 'יש כמות גדולה של לידים שכבר נכנסו למערכת ועדיין לא קיבלו קשר.'
          : 'יש לידים שכבר במערכת ועדיין לא קיבלו קשר.',
      action: 'לעבור על הלידים שלא קיבלו קשר',
    })
  }
  if (c.newLeads > 0) {
    out.push({
      key: 'newLeads',
      count: c.newLeads,
      fact: `נכנסו ${c.newLeads} לידים חדשים השבוע`,
      observation: 'יש עבודה חדשה שנכנסה השבוע לפי ה-CRM.',
      action: 'לבדוק את הלידים החדשים שנכנסו השבוע',
    })
  }
  if (c.meetingsToday > 0) {
    out.push({
      key: 'meetings',
      count: c.meetingsToday,
      fact: `יש ${c.meetingsToday} פגישות היום`,
      observation: 'יש פגישות שכבר עומדות ביומן.',
      action: 'להתכונן לפגישות שכבר קבועות להיום',
    })
  }
  return out
}

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

function composeState(top: Signal[], allClear: boolean): string {
  if (allClear) {
    return `מהנתונים שיש לי, אין כרגע שיחות ממתינות, משימות באיחור או לידים שלא בקשר.\n\n${HONEST_LIMIT}`
  }
  const head = `מהנתונים שיש לי, מה שקורה עכשיו הוא בעיקר זה: ${top[0].observation}`
  const facts = top.map((s) => `• ${s.fact}`).join('\n')
  const next = `אם הייתי בוחר צעד אחד: ${top[0].action}.`
  return `${head}\n\n${facts}\n\n${next}`
}

function composeAdvice(top: Signal[], allClear: boolean): string {
  if (allClear) {
    return `מהנתונים שיש לי, אין כרגע לידים לא מטופלים, מעקבים או שיחות ממתינות שאפשר לקדם מהם.\n\n${HONEST_LIMIT}`
  }
  const bottleneck =
    top[0].key === 'waiting'
      ? 'בשיחות שכבר ממתינות למענה'
      : top[0].key === 'stale'
        ? 'בלידים שכבר נכנסו ולא קיבלו קשר'
        : top[0].key === 'overdue'
          ? 'במשימות שכבר באיחור'
          : `ב${top[0].fact.replace(/^יש /, '')}`
  const support = top
    .slice(0, 3)
    .map((s) => s.fact)
    .join(', ובמקביל ')
  const why =
    top.length > 1
      ? `כלומר, יש עבודה קיימת שלא קיבלה המשך לפני שצריך לייצר עוד ביקוש.`
      : top[0].observation
  const action =
    top.length > 1 && top[0].key === 'waiting' && top.some((s) => s.key === 'stale')
      ? 'הייתי עובר קודם על מי שממתין למענה, ואז מתחיל לטפל בלידים שלא קיבלו קשר.'
      : `הייתי ${top[0].action}.`
  return `מהנתונים שיש לי, הייתי מתמקד קודם ${bottleneck}.\n\n${support}. ${why}\n\nאם הייתי בוחר פעולה אחת עכשיו: ${action}\n\n${HONEST_LIMIT}`
}

function composeSee(top: Signal[], allClear: boolean): string {
  if (allClear) {
    return `מה שאני רואה כרגע הוא שאין שיחות ממתינות, משימות באיחור או לידים שלא בקשר.\n\n${INSUFFICIENT} אין לי מדדי הכנסה או המרה לבסס עליהם בעיה נוספת.`
  }
  const items = top.slice(0, 3).map((s, i) => `${i + 1}. ${s.fact}`)
  const probe =
    top[0].key === 'stale' || top[0].key === 'waiting'
      ? 'הנקודה שהייתי בודק קודם היא האם מצליחים לטפל בלידים שכבר נכנסו לפני שמצטבר עוד עומס.'
      : `הנקודה שהייתי בודק קודם: ${top[0].observation}`
  return `מה שאני רואה כרגע:\n${items.join('\n')}\n\n${probe}`
}

function composeLeak(top: Signal[], allClear: boolean): string {
  const leak = top.filter((s) => s.key === 'stale' || s.key === 'waiting' || s.key === 'overdue')
  if (allClear || leak.length === 0) {
    return `${INSUFFICIENT} אין לי מספרי סגירה, המרה או לידים שסומנו כאבודים — אז אני לא יכול להגיד שאתה מפסיד לידים.`
  }
  const facts = leak.slice(0, 2).map((s) => `• ${s.fact}`)
  const obs =
    leak[0].key === 'stale'
      ? 'זה נראה כמו צוואר בקבוק תפעולי: לידים שכבר הגיעו ולא קיבלו קשר.'
      : leak[0].observation
  return `מהנתונים שיש לי, המקום לבדוק קודם:\n${facts.join('\n')}\n\n${obs}\n\n${HONEST_LIMIT}`
}

export function composeBusinessAdvice(kind: BusinessAdviceKind, c: GrowthCounts): string {
  const top = signals(c).slice(0, 3)
  const allClear = top.length === 0
  let text: string
  switch (kind) {
    case 'state':
      text = composeState(top, allClear)
      break
    case 'advice':
      text = composeAdvice(top, allClear)
      break
    case 'see':
      text = composeSee(top, allClear)
      break
    case 'leak':
      text = composeLeak(top, allClear)
      break
  }
  return containsUnsupportedBusinessClaim(text) ? `${INSUFFICIENT} ${HONEST_LIMIT}` : text
}
