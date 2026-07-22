/**
 * One resolved display name per user, everywhere.
 *
 * The product must never show two name sources at once, and never show a raw
 * null. Resolution order:
 *
 *   1. Profile name   — what the user set inside SocialCRM
 *   2. OAuth name     — Google, used only until a profile name exists
 *   3. Email username — the part before "@"
 *   4. Generic
 *
 * Why step 1 is two-part: `users.name` is a Postgres GENERATED column,
 *   name = ("firstName" || ' ' || "lastName")
 * and Postgres yields NULL for any concatenation containing NULL. A user with
 * a first name but no last name therefore has name = NULL even though their
 * profile name is perfectly good. Composing from the parts recovers it before
 * we fall through to OAuth.
 */

export type NameSource = {
  name?: string | null
  gglName?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}

/** Shown only when every source is empty. */
export const GENERIC_DISPLAY_NAME = 'משתמש'

const clean = (value?: string | null): string => (typeof value === 'string' ? value.trim() : '')

export function getDisplayName(user?: NameSource | null): string {
  if (!user) return GENERIC_DISPLAY_NAME

  const profile = clean(user.name) || [clean(user.firstName), clean(user.lastName)].filter(Boolean).join(' ')
  if (profile) return profile

  const oauth = clean(user.gglName)
  if (oauth) return oauth

  const email = clean(user.email)
  const localPart = email.includes('@') ? email.slice(0, email.indexOf('@')) : email
  if (localPart) return localPart

  return GENERIC_DISPLAY_NAME
}

/**
 * First token of the resolved display name, for greetings. Returns '' rather
 * than the generic fallback — a greeting with no name reads better than one
 * addressed to "משתמש".
 */
export function getFirstName(user?: NameSource | null): string {
  const full = getDisplayName(user)
  if (full === GENERIC_DISPLAY_NAME) return ''
  return full.split(/\s+/)[0] ?? ''
}
