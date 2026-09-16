/**
 * Tenant-scoped business identity for IRE. Who this WhatsApp conversation
 * represents — the business the agent speaks FOR, and the only facts it may
 * state on that business's behalf.
 *
 * Lookup is always keyed by agencyId. Never search globally.
 *
 * The prompt block this builds is deliberately industry-neutral. It names no
 * trade, assumes no sales motion, and carries no discovery topics of its own:
 * what the business does, what it may say, and how it should converse all come
 * from the owner's saved settings. A clinic, a garage and a software vendor each
 * get a block built the same way and populated only from their own row.
 */
import { db } from '@/config/db'
import { isOwnBusinessAccount } from './ownBusinessAccount'

export type BusinessIdentity = {
  agencyId: number
  name: string | null
  /** What the business does + facts the agent may state. Owner-authored. */
  guidance: string | null
  /** How the agent should converse for this business. Owner-authored, optional. */
  agentInstructions: string | null
  /** True only for SocialCRM's own account — see ownBusinessAccount.ts. */
  isOwnProductBusiness: boolean
}

export function emptyBusinessIdentity(agencyId: number): BusinessIdentity {
  return { agencyId, name: null, guidance: null, agentInstructions: null, isOwnProductBusiness: false }
}

function asPositiveAgencyId(agencyId: number): number | null {
  if (!Number.isFinite(agencyId) || agencyId <= 0) return null
  return Math.floor(agencyId)
}

function trimmedOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Load the connected business's name + owner-authored information for this
 * agency only. `channel` keeps settings on the same (agencyId, channel) row IRE
 * already uses.
 */
export async function loadBusinessIdentity(agencyId: number, channel: string): Promise<BusinessIdentity> {
  const id = asPositiveAgencyId(agencyId)
  if (!id) return emptyBusinessIdentity(agencyId)
  const agency = await db('agencies').where({ id }).first('id', 'name')
  if (!agency || Number(agency.id) !== id) return emptyBusinessIdentity(id)
  const settings = await db('auto_response_settings')
    .where({ agencyId: id, channel })
    .first('agencyId', 'guidance', 'agentInstructions')
  const own = settings && Number(settings.agencyId) === id ? settings : null
  return {
    agencyId: id,
    name: trimmedOrNull(agency.name),
    guidance: trimmedOrNull(own?.guidance),
    agentInstructions: trimmedOrNull(own?.agentInstructions),
    isOwnProductBusiness: isOwnBusinessAccount(id),
  }
}

/** True when the owner has given the agent real facts to speak from. */
export function hasBusinessFacts(identity: BusinessIdentity): boolean {
  return Boolean(identity.guidance)
}

/**
 * Prompt block. Does not include agencyId (internal tenant key, not a customer
 * fact). Industry-neutral by construction: every business-specific line is
 * interpolated from the tenant's own row, and a field the owner left empty
 * produces an explicit "not supplied" marker rather than a plausible guess.
 */
export function formatBusinessIdentityBlock(identity: BusinessIdentity): string {
  const lines: string[] = ['זהות העסק — העסק שאת/ה מייצג/ת בשיחת הוואטסאפ הזו:']

  lines.push(identity.name ? `שם העסק: ${identity.name}` : 'שם העסק: (לא סופק)')
  lines.push(
    identity.guidance
      ? `מה העסק עושה, ומה מותר לומר בשמו (עובדות מאומתות; מותר לצטט): ${identity.guidance}`
      : 'מה העסק עושה: (לא סופק). אין לך עובדות מאומתות על העסק הזה.',
  )

  if (identity.agentInstructions) {
    lines.push(`הנחיות מבעל/ת העסק לניהול השיחה: ${identity.agentInstructions}`)
  }

  lines.push(
    'את/ה הנציג/ה של העסק הזה ושל אף עסק אחר. שאלות על מי אתם, מה אתם מציעים, או שהלקוח הגיע מפרסום שלכם — ענה/י ישירות, אך ורק ממה שכתוב למעלה.',
  )
  lines.push(
    'אסור להמציא שירות, מוצר, יכולת, מחיר, מדיניות, התחייבות, או פעולה שכבר בוצעה. אם זה לא כתוב למעלה, זה לא קיים בשבילך.',
  )
  lines.push(
    'אין לך מידע על עסקים אחרים, על מערכות אחרות, או על תוכנה שאינך מייצג/ת. אל תזכיר/י אותם ואל תציע/י אותם.',
  )
  lines.push(
    'כשחסר מידע: אמור/אמרי בכנות שאין לך את הפרט הזה, ואז שאל/י שאלה ממוקדת אחת או הצע/י שאדם מהצוות יחזור ללקוח. עדיף לא לדעת מאשר להמציא.',
  )
  lines.push(
    'בירור צרכים הוא תמיד על הלקוח ועל מה שהוא צריך — לא על העסק. לעולם אל תשאל/י את הלקוח מה העסק הזה עושה, מאיזה קישור הגיע, או לבקש צילום מסך של פרסום.',
  )

  return lines.join('\n')
}
