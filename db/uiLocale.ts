import { db } from '@/config/db'
import type { UiLocale } from '@/lib/i18n/config'

/**
 * Interface-language preferences. Both columns are nullable; NULL means "no
 * explicit choice" and resolves to the next level (see lib/i18n/resolve.ts).
 * `agencies.locale` is the billing/invoice locale and is never read or written here.
 *
 * One round trip: the user's row joined to their own agency row on the
 * session's agencyId, so a user can only ever see their own agency's default.
 */
export async function getUiLocalePrefs(
  userId: number,
  agencyId: number,
): Promise<{ userLocale: string | null; agencyLocale: string | null }> {
  const row = await db('users')
    .leftJoin('agencies', 'agencies.id', 'users.agencyId')
    .where('users.id', userId)
    .andWhere('users.agencyId', agencyId)
    .first('users.uiLocale as userLocale', 'agencies.uiLocale as agencyLocale')
  return { userLocale: row?.userLocale ?? null, agencyLocale: row?.agencyLocale ?? null }
}

/** Scoped by user id AND agency id: a row outside the caller's agency is never touched. */
export async function setUserUiLocale(userId: number, agencyId: number, locale: UiLocale | null): Promise<number> {
  return db('users').where({ id: userId, agencyId }).update({ uiLocale: locale })
}

export async function setAgencyUiLocale(agencyId: number, locale: UiLocale | null): Promise<number> {
  return db('agencies').where({ id: agencyId }).update({ uiLocale: locale })
}
