type MetaField = { name: string; values: string[] }

export type ParsedFacebookLead = {
  firstName: string
  /**
   * Always a string: `clients.lastName` is NOT NULL. An absent surname is ''
   * (the convention of every other lead path). A null here made the insert fail
   * and the lead was lost — 29 production leads, 2026-07-31 → 09-27.
   */
  lastName: string
  phone: string | null
  email: string | null
}

const PLACEHOLDER_FIRST_NAME = 'ליד מפייסבוק'

/**
 * Name, phone and email from a Lead Ads `field_data` array. Meta forms carry
 * either one `full_name` or the standard `first_name` / `last_name` pair.
 */
export function parseFacebookLead(fieldData: MetaField[]): ParsedFacebookLead {
  try {
    const get = (key: string): string | null => fieldData.find((f) => f.name === key)?.values?.[0]?.trim() || null

    const fullName = get('full_name') ?? get('name')
    let firstName: string | null
    let lastName: string
    if (fullName) {
      const parts = fullName.split(/\s+/).filter(Boolean)
      firstName = parts[0] ?? null
      lastName = parts.slice(1).join(' ')
    } else {
      firstName = get('first_name')
      lastName = get('last_name') ?? ''
    }

    const phone = get('phone_number') ?? get('phone') ?? null
    const email = get('email') ?? null

    return { firstName: firstName || PLACEHOLDER_FIRST_NAME, lastName, phone, email }
  } catch (err) {
    console.error('[parseFacebookLead] Failed to parse field_data:', err)
    return { firstName: PLACEHOLDER_FIRST_NAME, lastName: '', phone: null, email: null }
  }
}
