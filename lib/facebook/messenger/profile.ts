import { db } from '@/config/db'
import { graphRequest } from '@/lib/facebook/graphClient'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { setMessengerCustomerNameIfMissing } from '@/db/messenger'

/**
 * Best-effort display name for a new Messenger contact (User Profile API:
 * GET /{PSID}?fields=first_name,last_name with the Page token). The webhook
 * carries no name, and a rep needs one to recognise a conversation.
 *
 * Runs after the webhook has answered (`after()`), at most once per contact:
 * it returns before any Graph call when the name is already known. A refusal
 * (privacy settings, missing permission) leaves the name empty — the UI then
 * shows a neutral label, never an invented one. Nothing is thrown.
 */
export async function fillMessengerCustomerName(input: {
  conversationId: number
  agencyId: number
  pageId: string
}): Promise<void> {
  try {
    const conversation = await db('messenger_conversations')
      .where({ id: input.conversationId, agencyId: input.agencyId })
      .first('psid', 'customerName')
    if (!conversation || conversation.customerName) return

    const page = await db('facebook_pages')
      .where({ page_id: input.pageId, agency_id: input.agencyId })
      .first('page_access_token')
    if (!page) return

    const result = await graphRequest<{ first_name?: string; last_name?: string }>({
      path: `/${encodeURIComponent(conversation.psid)}`,
      token: resolvePageAccessToken(page.page_access_token),
      query: { fields: 'first_name,last_name' },
      timeoutMs: 4000,
    })
    if (!('data' in result)) return

    const name = [result.data.first_name, result.data.last_name]
      .filter((p) => typeof p === 'string' && p.trim())
      .join(' ')
      .trim()
    if (name) await setMessengerCustomerNameIfMissing(input.conversationId, input.agencyId, name)
  } catch {
    // Display nicety only — never let it surface.
  }
}
