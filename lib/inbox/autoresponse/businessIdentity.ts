/**
 * Tenant-scoped business identity for IRE. Who this WhatsApp conversation
 * represents — not SocialCRM product capabilities, not customer discovery.
 *
 * Lookup is always keyed by agencyId. Never search globally.
 */
import { db } from '@/config/db'

export type BusinessIdentity = {
  agencyId: number
  name: string | null
  guidance: string | null
}

export function emptyBusinessIdentity(agencyId: number): BusinessIdentity {
  return { agencyId, name: null, guidance: null }
}

function asPositiveAgencyId(agencyId: number): number | null {
  if (!Number.isFinite(agencyId) || agencyId <= 0) return null
  return Math.floor(agencyId)
}

/**
 * Load the connected business's name + guidance for this agency only.
 * `channel` keeps settings on the same (agencyId, channel) row IRE already uses.
 */
export async function loadBusinessIdentity(agencyId: number, channel: string): Promise<BusinessIdentity> {
  const id = asPositiveAgencyId(agencyId)
  if (!id) return emptyBusinessIdentity(agencyId)
  const agency = await db('agencies').where({ id }).first('id', 'name')
  if (!agency || Number(agency.id) !== id) return emptyBusinessIdentity(id)
  const name = typeof agency.name === 'string' && agency.name.trim() ? agency.name.trim() : null
  const settings = await db('auto_response_settings')
    .where({ agencyId: id, channel })
    .first('agencyId', 'guidance')
  const guidance =
    settings && Number(settings.agencyId) === id && typeof settings.guidance === 'string' && settings.guidance.trim()
      ? settings.guidance.trim()
      : null
  return { agencyId: id, name, guidance }
}

/** Prompt block. Does not include agencyId (internal tenant key, not a customer fact). */
export function formatBusinessIdentityBlock(identity: BusinessIdentity): string {
  const name = identity.name?.trim() || '(לא סופק שם)'
  const guidance = identity.guidance?.trim() || '(לא סופק תיאור)'
  return [
    'זהות העסק (עובדות מאומתות של העסק שאת/ה מייצג/ת בשיחת הוואטסאפ הזו; מותר לצטט):',
    `שם העסק: ${name}`,
    `מה העסק עושה: ${guidance}`,
    'את/ה הנציג/ת של העסק הזה. שאלות על מי אתם, מה אתם מציעים, או שהלקוח הגיע מהמודעה/פרסום שלכם — ענה ישירות.',
    'אל תשאל/י את הלקוח מה העסק עושה, מאיזה קישור הגיע, או לבקש צילום מסך של מודעה — אלא אם ביקש במפורש תוכן מודעה שאין בזהות או בעובדות המוצר.',
    'גילוי לקוח הוא רק על הלקוח: כאב, כמות לידים, צוות, תהליך נוכחי, דחיפות, תוצאה רצויה. לא על זהות העסק.',
    'אסור להמציא מחיר, הנחה, התחייבות, מועד, או יכולת שלא אומתה בזהות או בעובדות המוצר.',
  ].join('\n')
}
