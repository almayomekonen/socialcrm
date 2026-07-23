export type ParsedWhatsappLead = {
  firstName: string
  lastName: string | null
  phone: string | null
}

export function parseWhatsappLead(from: string, profileName: string | null | undefined): ParsedWhatsappLead {
  try {
    const parts = (profileName ?? '').trim().split(' ').filter(Boolean)
    const firstName = parts[0] || 'ליד מוואטסאפ'
    // clients.lastName is NOT NULL. WhatsApp profile names are often a single
    // token (or emoji), which yields no surname — default to '' so the lead
    // insert never violates the constraint. Multi-token names are unaffected.
    const lastName = parts.slice(1).join(' ') || ''

    // 'from' is already the sender's phone in E.164 without '+', e.g. "972501234567"
    const digits = from.replace(/\D/g, '')
    const phone = digits.length >= 9 ? (digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')) : null

    return { firstName, lastName, phone }
  } catch (err) {
    console.error('[parseWhatsappLead] Failed to parse:', err)
    return { firstName: 'ליד מוואטסאפ', lastName: '', phone: null }
  }
}
