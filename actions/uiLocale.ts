'use server'

import { refresh } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { canUseUiLocales } from '@/lib/flags/uiLocaleFlags'
import { isUiLocale, type UiLocale } from '@/lib/i18n/config'
import { setAgencyUiLocale, setUserUiLocale } from '@/db/uiLocale'

/**
 * Interface-language mutations.
 *
 * Tenant isolation: neither action accepts a user id or agency id. Both are
 * taken from the session, so changing the request payload can only ever change
 * the caller's own preference or the caller's own agency default.
 *
 * Deliberately NOT entitlement-gated (requireAgencyUser, not
 * requireProductAccess): choosing the language you read the product in spends
 * nothing, and a lapsed customer must still be able to read their screen.
 *
 * `null` clears the choice ("use the business default" / "use the system default").
 *
 * `refresh()`, not `revalidatePath`: the preference is read per request and is
 * never in a shared cache, so there is nothing to invalidate — the caller's
 * router only needs to re-render. Revalidating the whole layout tree would
 * discard cached data for every tenant to change one person's language.
 */

function parseLocale(value: unknown): UiLocale | null {
  if (value === null || value === '') return null
  if (!isUiLocale(value)) throw new Error('unsupported_locale')
  return value
}

export async function setMyUiLocale(value: unknown): Promise<void> {
  const user = await requireAgencyUser()
  if (!canUseUiLocales(user.agencyId)) throw new Error('ui_locale_disabled')
  const locale = parseLocale(value)
  await setUserUiLocale(user.id, user.agencyId, locale)
  refresh()
}

export async function setAgencyDefaultUiLocale(value: unknown): Promise<void> {
  const user = await requireAgencyUser()
  if (!isAdmin(user.role)) throw new Error('forbidden')
  if (!canUseUiLocales(user.agencyId)) throw new Error('ui_locale_disabled')
  const locale = parseLocale(value)
  await setAgencyUiLocale(user.agencyId, locale)
  refresh()
}
