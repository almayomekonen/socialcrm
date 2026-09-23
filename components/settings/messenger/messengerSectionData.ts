import 'server-only'

import { parseGrantedScopes } from '@/db/facebook'
import { hasFeatureScopes, isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { isAdmin, type Roles } from '@/types/roles'
import {
  EMPTY_MESSENGER_PROFILE,
  getMessengerProfile,
  type MessengerProfileConfig,
} from '@/lib/facebook/messenger/messengerProfileApi'
import { listMessengerSavedReplies, type MessengerSavedReply } from '@/db/messengerSavedReplies'

/**
 * Whether the Messenger entry-points section belongs on this settings page, and
 * what it should show.
 *
 * Extracted from LeadSourcesSection, which is an accordion composition and had
 * no business also deciding eligibility and calling Graph (architecture-rules
 * §1 and §3 — the file crossed the 250-line soft limit when this was inlined,
 * and a UI file should not be making Meta calls in the first place).
 *
 * The read happens ONCE per page render: Meta allows ten messenger_profile
 * calls per ten minutes per Page.
 */

export type MessengerSectionData =
  | { visible: false }
  | {
      visible: true
      pageId: string
      profile: MessengerProfileConfig
      readFailed: boolean
      savedReplies: MessengerSavedReply[]
    }

type PageRow = { page_id: string; granted_scopes: unknown; page_access_token: string } | null | undefined

export async function loadMessengerSection(
  user: { role: string; agencyId: number },
  page: PageRow,
): Promise<MessengerSectionData> {
  // Something to configure, and someone who may. A rep cannot change a
  // Page-wide setting, so rendering them a form they cannot submit would be a
  // dead control.
  const eligible =
    !!page &&
    isFacebookMessengerEnabledForAgency(user.agencyId) &&
    isAdmin(user.role as Roles) &&
    hasFeatureScopes(parseGrantedScopes(page.granted_scopes), 'messenger')
  if (!eligible) return { visible: false }

  // Saved replies are OUR data and always readable; they must not be lost
  // because Meta was slow, so they are fetched independently of the profile.
  const savedReplies = await listMessengerSavedReplies(user.agencyId).catch(() => [])

  try {
    const read = await getMessengerProfile({
      pageId: page.page_id,
      pageAccessToken: resolvePageAccessToken(page.page_access_token),
    })
    if ('error' in read) {
      return { visible: true, pageId: page.page_id, profile: EMPTY_MESSENGER_PROFILE, readFailed: true, savedReplies }
    }
    return { visible: true, pageId: page.page_id, profile: read.profile, readFailed: false, savedReplies }
  } catch {
    // A sealed token this deployment cannot open is a deployment fault, not the
    // customer's. The section says so rather than rendering empty fields that
    // would silently overwrite live settings on save.
    return { visible: true, pageId: page.page_id, profile: EMPTY_MESSENGER_PROFILE, readFailed: true, savedReplies }
  }
}
