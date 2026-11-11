/**
 * The pure half of the CRM context: the relationship rule, the shape, and the
 * prompt block. No database access, so the prompt layer (and the eval script)
 * can import it. The reads live in ./crmContext.ts.
 */
import { businessDateString } from '@/lib/today/time'
import { BUSINESS_TZ } from '@/lib/today/constants'

export type Relationship = 'existing_customer' | 'lost' | 'prospect' | 'contact'

export type MeetingFact = { startAtMs: number; title: string; status: string }

export type CrmContext = {
  relationship: Relationship
  leadStatus: string | null
  /** Deals of this lead with a sale date. */
  completedSales: number
  lastSaleAtMs: number | null
  /** The next scheduled appointment of this lead, if any. */
  nextMeeting: MeetingFact | null
  /** The most recent past appointment of this lead (scheduled, completed or no-show), if any. */
  lastMeeting: MeetingFact | null
}

export function relationshipFrom(leadStatus: string | null, completedSales: number, hasLead: boolean): Relationship {
  if (!hasLead) return 'contact'
  if (leadStatus === 'lost') return 'lost'
  if (leadStatus === 'closed' || completedSales > 0) return 'existing_customer'
  return 'prospect'
}

function at(ms: number): string {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
  return `${businessDateString(ms)} ${time}`
}

const RELATIONSHIP_LINE: Record<Relationship, string> = {
  existing_customer: 'לקוח/ה קיים/ת של העסק (לפי SocialCRM). דבר/י כמו עם מי שכבר עובדים איתו: בלי "ברוך הבא", בלי להציג את העסק מחדש, ובלי שאלות היכרות.',
  lost: 'פנייה קודמת שלא התקדמה (סומנה כלא רלוונטית). זה לא לקוח קיים. ענה/י בנימוס כמו לפנייה חדשה, בלי להזכיר את הסימון.',
  prospect: 'פנייה פתוחה של מתעניין/ת שעדיין לא לקוח/ה.',
  contact: 'איש קשר שאין עליו מידע ב-SocialCRM. אל תניח/י שזה לקוח, ואל תניח/י שזו שיחה אישית: ההודעה עצמה קובעת.',
}

/** Prompt block. Internal: the customer never sees these words, and nothing here may be quoted as a status. */
export function formatCrmContextBlock(c: CrmContext): string {
  const lines = ['מה SocialCRM יודע על השולח (מידע פנימי, לא לצטט ולא להזכיר שיש מערכת):', RELATIONSHIP_LINE[c.relationship]]
  if (c.completedSales > 0) lines.push(`עסקאות שנסגרו עם השולח: ${c.completedSales}${c.lastSaleAtMs ? `, האחרונה ב-${businessDateString(c.lastSaleAtMs)}` : ''}.`)
  if (c.nextMeeting) lines.push(`פגישה קרובה שנקבעה: ${at(c.nextMeeting.startAtMs)}${c.nextMeeting.title ? ` (${c.nextMeeting.title})` : ''}. מותר לאשר את המועד הזה אם נשאלת עליו. אסור לשנות, לבטל או להזיז אותו מכאן.`)
  if (c.lastMeeting) lines.push(`פגישה אחרונה: ${at(c.lastMeeting.startAtMs)}${c.lastMeeting.title ? ` (${c.lastMeeting.title})` : ''}.`)
  if (!c.nextMeeting && c.relationship !== 'contact') lines.push('אין פגישה עתידית רשומה. אם שואלים על פגישה: אל תמציא/י מועד, ואמור/אמרי בכנות שאין לך מועד רשום מולך.')
  return lines.join('\n')
}
