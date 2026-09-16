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
import { formatAgentCapabilityBlock } from './agentCapabilities'
import {
  formatBusinessProfileBlock,
  groundedFactsFromProfile,
  isProfileCurrent,
  parseBusinessProfile,
  type BusinessProfile,
} from './businessProfile'

export type BusinessIdentity = {
  agencyId: number
  name: string | null
  /** What the business does + facts the agent may state. Owner-authored. */
  guidance: string | null
  /** How the agent should converse for this business. Owner-authored, optional. */
  agentInstructions: string | null
  /** True only for SocialCRM's own account — see ownBusinessAccount.ts. */
  isOwnProductBusiness: boolean
  /**
   * The structured profile derived from `guidance` when the owner saved. Null
   * when never derived, or stale relative to the current text — in which case
   * the agent falls back to reading the description as prose, exactly as before.
   */
  profile: BusinessProfile | null
}

export function emptyBusinessIdentity(agencyId: number): BusinessIdentity {
  return { agencyId, name: null, guidance: null, agentInstructions: null, isOwnProductBusiness: false, profile: null }
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
    .first('agencyId', 'guidance', 'agentInstructions', 'businessProfile')
  const own = settings && Number(settings.agencyId) === id ? settings : null
  const guidance = trimmedOrNull(own?.guidance)
  const stored = parseBusinessProfile(own?.businessProfile)
  // A profile derived from different text is not used. The owner edited their
  // description; serving the old structure would answer from words they removed.
  const profile = isProfileCurrent(stored, guidance) ? stored : null
  return {
    agencyId: id,
    name: trimmedOrNull(agency.name),
    guidance,
    agentInstructions: trimmedOrNull(own?.agentInstructions),
    isOwnProductBusiness: isOwnBusinessAccount(id),
    profile,
  }
}

/**
 * The corpus a price figure or process claim is checked against. The derived
 * profile's quotable sections when present, else the raw description.
 * Objectives are excluded by `groundedFactsFromProfile` — "we book
 * appointments" must never license a booking claim.
 */
export function groundedFactsFor(identity: BusinessIdentity): string | null {
  const fallback = [identity.guidance, identity.agentInstructions].filter(Boolean).join('\n') || null
  return groundedFactsFromProfile(identity.profile, fallback)
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

  // The derived profile when it is current, because it separates facts from
  // objectives; the raw description otherwise, which is what the agent read
  // before profiles existed and remains a working fallback.
  const structured = identity.profile ? formatBusinessProfileBlock(identity.profile) : null
  if (structured) {
    lines.push(structured)
  } else {
    lines.push(
      identity.guidance
        ? `מה העסק עושה, ומה מותר לומר בשמו (עובדות מאומתות; מותר לצטט): ${identity.guidance}`
        : 'מה העסק עושה: (לא סופק). אין לך עובדות מאומתות על העסק הזה.',
    )
  }

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

  // Capabilities are system-owned and identical for every business. Emitted
  // last, so a description asking for something impossible is corrected after
  // it has been read. See agentCapabilities.ts.
  lines.push(formatAgentCapabilityBlock())

  return lines.join('\n')
}
