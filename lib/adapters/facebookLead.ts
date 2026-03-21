type MetaField = { name: string; values: string[] }

export type ParsedFacebookLead = {
  firstName: string
  lastName: string | null
  phone: string | null
  email: string | null
}

export function parseFacebookLead(fieldData: MetaField[]): ParsedFacebookLead {
  try {
    const get = (key: string): string | null => fieldData.find((f) => f.name === key)?.values?.[0] ?? null

    const fullName = get('full_name') ?? get('name') ?? ''
    const parts = fullName.trim().split(' ').filter(Boolean)
    const firstName = parts[0] || 'ליד מפייסבוק'
    const lastName = parts.slice(1).join(' ') || null

    const phone = get('phone_number') ?? get('phone') ?? null
    const email = get('email') ?? null

    return { firstName, lastName, phone, email }
  } catch (err) {
    console.error('[parseFacebookLead] Failed to parse field_data:', err)
    return { firstName: 'ליד מפייסבוק', lastName: null, phone: null, email: null }
  }
}
