/**
 * Deterministic growth copy. Facts only — never invents revenue or rates.
 */
export type GrowthCounts = {
  overdueTasks: number
  dueToday: number
  staleLeads: number
  waitingConversations: number
  newLeads: number
  meetingsToday: number
}

function joinHe(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} ו${parts[parts.length - 1]}`
}

export function composeGrowthCopy(c: GrowthCounts): string {
  const parts: string[] = []
  if (c.staleLeads > 0) parts.push(`${c.staleLeads} לידים שלא היו בקשר`)
  if (c.waitingConversations > 0)
    parts.push(c.waitingConversations === 1 ? '1 שיחה שממתינה' : `${c.waitingConversations} שיחות ממתינות`)
  if (c.overdueTasks > 0) parts.push(`${c.overdueTasks} משימות באיחור`)
  if (c.dueToday > 0) parts.push(`${c.dueToday} מעקבים להיום`)
  if (c.newLeads > 0) parts.push(`${c.newLeads} לידים חדשים השבוע`)
  if (c.meetingsToday > 0) parts.push(`${c.meetingsToday} פגישות היום`)

  const limit = 'אין לי נתוני הכנסה או סגירות, אז אני לא יכול לחשב כמה כסף חסר.'
  if (parts.length === 0) {
    return `${limit} לפי ה-CRM אין כרגע לידים לא מטופלים, מעקבים או שיחות ממתינות.`
  }

  let rec = 'הייתי מתחיל בטיפול במה שכבר פתוח אצלך.'
  if (c.overdueTasks > 0) rec = 'הייתי מתחיל במשימות שבאיחור.'
  else if (c.dueToday > 0) rec = 'הייתי מתחיל במעקבים להיום.'
  else if (c.staleLeads > 0 && c.waitingConversations > 0) {
    rec = 'הייתי מתחיל בטיפול בלידים שלא קיבלו קשר ובסגירת השיחה שממתינה.'
  } else if (c.staleLeads > 0) rec = 'הייתי מתחיל בטיפול בלידים שלא קיבלו קשר.'
  else if (c.waitingConversations > 0) rec = 'הייתי מתחיל בסגירת השיחה שממתינה.'

  return `${limit} לפי הנתונים שיש לי, יש כרגע ${joinHe(parts)}. ${rec}`
}
