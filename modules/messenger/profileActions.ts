'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireAgencyUser } from '@/lib/requireUser'
import { isAdmin, type Roles } from '@/types/roles'
import { parseGrantedScopes } from '@/db/facebook'
import { hasFeatureScopes, isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { describeGraphError } from '@/lib/facebook/graphClient'
import {
  EMPTY_MESSENGER_PROFILE,
  GREETING_MAX,
  getMessengerProfile,
  MENU_MAX_ITEMS,
  MENU_TITLE_MAX,
  saveMessengerProfile,
  type MessengerProfileConfig,
} from '@/lib/facebook/messenger/messengerProfileApi'

/**
 * Read and write a Page's Messenger entry points — greeting, Get Started,
 * persistent menu.
 *
 * ADMIN ONLY. This changes what every customer of the business sees before they
 * have said anything. It is a Page-wide setting, not a per-rep preference, so a
 * נציג can neither read nor change it.
 *
 * TENANCY: the Page must belong to the caller's agency. `pageId` is accepted
 * from the client but is only ever used inside a query scoped by `agency_id`,
 * so naming another tenant's Page finds nothing.
 */

export type MessengerProfileFailure =
  | 'not_enabled'
  | 'forbidden'
  | 'not_found'
  | 'permission_missing'
  | 'invalid'
  | 'rate_limited'
  | 'meta_error'

export type MessengerProfileReadResult =
  | { ok: true; profile: MessengerProfileConfig }
  | { ok: false; reason: MessengerProfileFailure }

export type MessengerProfileSaveResult = { ok: true } | { ok: false; reason: MessengerProfileFailure }

async function authorize(pageId: string) {
  const user = await requireAgencyUser()
  if (!isFacebookMessengerEnabledForAgency(user.agencyId)) return { reason: 'not_enabled' as const }
  if (!isAdmin(user.role as Roles)) return { reason: 'forbidden' as const }

  const id = typeof pageId === 'string' ? pageId.trim() : ''
  if (!id) return { reason: 'not_found' as const }

  const connection = await db('facebook_pages').where({ page_id: id, agency_id: user.agencyId }).first()
  if (!connection) return { reason: 'not_found' as const }
  if (!hasFeatureScopes(parseGrantedScopes(connection.granted_scopes), 'messenger')) {
    return { reason: 'permission_missing' as const }
  }

  try {
    return { pageId: id, pageAccessToken: resolvePageAccessToken(connection.page_access_token) }
  } catch {
    console.error('[MessengerProfile] Page token could not be opened')
    return { reason: 'meta_error' as const }
  }
}

/** Meta's rate limit here is 10 calls / 10 minutes per Page — worth naming. */
function classify(error: { kind: string; code: number | null }): MessengerProfileFailure {
  if (error.kind !== 'graph') return 'meta_error'
  if (error.code === 4 || error.code === 17 || error.code === 32 || error.code === 613) return 'rate_limited'
  if (error.code === 10 || (error.code !== null && error.code >= 200 && error.code <= 299)) return 'permission_missing'
  return 'meta_error'
}

export async function readMessengerProfile(pageId: string): Promise<MessengerProfileReadResult> {
  const auth = await authorize(pageId)
  if ('reason' in auth) return { ok: false, reason: auth.reason }

  const result = await getMessengerProfile({ pageId: auth.pageId, pageAccessToken: auth.pageAccessToken })
  if ('error' in result) {
    console.warn('[MessengerProfile] read failed', { detail: describeGraphError(result.error) })
    return { ok: false, reason: classify(result.error) }
  }
  return { ok: true, profile: result.profile }
}

/**
 * Validate on the server, not only in the form.
 *
 * Meta enforces these too, but its refusal arrives as an opaque code after a
 * round trip that also spends one of the ten calls per ten minutes. Checking
 * here turns it into a sentence the admin can act on, for free.
 */
export function validateMessengerProfile(config: MessengerProfileConfig): string | null {
  if (config.greeting.length > GREETING_MAX) return `הודעת הפתיחה ארוכה מדי (עד ${GREETING_MAX} תווים)`
  const items = config.menuItems.filter((i) => i.title.trim())
  if (items.length > MENU_MAX_ITEMS) return `אפשר עד ${MENU_MAX_ITEMS} פריטים בתפריט`
  if (items.some((i) => i.title.trim().length > MENU_TITLE_MAX)) {
    return `שם פריט בתפריט ארוך מדי (עד ${MENU_TITLE_MAX} תווים)`
  }
  // A menu-only conversation with no menu leaves the customer unable to say
  // anything at all.
  if (config.composerInputDisabled && items.length === 0) {
    return 'אי אפשר לחסום הקלדה בלי תפריט — הפונה לא יוכל לכתוב כלום'
  }
  return null
}

export async function updateMessengerProfile(
  pageId: string,
  config: MessengerProfileConfig,
): Promise<MessengerProfileSaveResult> {
  const auth = await authorize(pageId)
  if ('reason' in auth) return { ok: false, reason: auth.reason }

  // Rebuilt from scratch rather than trusting the posted object: a Server Action
  // argument is client-controlled, and only these fields may ever be sent on.
  const safe: MessengerProfileConfig = {
    greeting: typeof config?.greeting === 'string' ? config.greeting.trim() : '',
    getStartedPayload: EMPTY_MESSENGER_PROFILE.getStartedPayload,
    composerInputDisabled: config?.composerInputDisabled === true,
    menuItems: Array.isArray(config?.menuItems)
      ? config.menuItems
          .slice(0, MENU_MAX_ITEMS)
          .filter((i) => i && typeof i.title === 'string' && i.title.trim())
          .map((i) => ({
            type: 'postback' as const,
            title: i.title.trim(),
            payload: typeof i.payload === 'string' && i.payload.trim() ? i.payload.trim() : i.title.trim(),
          }))
      : [],
  }

  const invalid = validateMessengerProfile(safe)
  if (invalid) return { ok: false, reason: 'invalid' }

  const result = await saveMessengerProfile({
    pageId: auth.pageId,
    pageAccessToken: auth.pageAccessToken,
    config: safe,
  })
  if ('error' in result) {
    console.warn('[MessengerProfile] save failed', { detail: describeGraphError(result.error) })
    return { ok: false, reason: classify(result.error) }
  }
  revalidatePath('/settings/integrations')
  return { ok: true }
}
