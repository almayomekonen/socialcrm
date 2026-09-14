export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return ''
  return String(email).trim().toLowerCase()
}

/**
 * Shape check only — `something@domain.tld`. It rejects "natel" (production
 * agency 150: a phone typo stored as the account email, which made the magic-link
 * login unreachable and forced a duplicate workspace 7 minutes later). It does
 * NOT prove the address exists; a well-formed typo still passes.
 */
const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@.]{2,}$/

export function isValidEmail(email: string): boolean {
  return EMAIL_SHAPE.test(email)
}
