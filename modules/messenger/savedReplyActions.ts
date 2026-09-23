'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { isAdmin, type Roles } from '@/types/roles'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import {
  asContent,
  countMessengerSavedReplies,
  createMessengerSavedReply,
  deleteMessengerSavedReply,
  getMessengerSavedReply,
  SAVED_REPLY_LIMIT,
  updateMessengerSavedReply,
  type MessengerSavedReply,
  type SavedReplyInput,
} from '@/db/messengerSavedReplies'
import {
  validateRichContent,
  type MessengerButton,
  type MessengerQuickReply,
  type MessengerRichContent,
} from '@/lib/facebook/messenger/structured'
import { messengerAssetType, type MessengerSendableType } from '@/lib/facebook/messenger/attachmentRules'
import { MESSENGER_TEXT_MAX } from '@/lib/facebook/messenger/rules'

/**
 * Saved replies: manage (admin) and send (any נציג).
 *
 * WHO MAY DO WHAT. Writing a snippet changes what the whole team sends to
 * customers, so creating, editing and deleting are ADMIN actions. Sending one is
 * an ordinary reply, so any rep with product access may — that is the entire
 * point of the feature.
 *
 * Every argument here is client-controlled. Nothing posted is stored as given:
 * the payload is rebuilt field by field below, and then validated against the
 * same pure rules the form used.
 */

export type SavedReplyFailure =
  | 'not_enabled'
  | 'forbidden'
  | 'not_found'
  | 'title_taken'
  | 'empty'
  | 'too_many'
  | 'invalid'

export type SavedReplyResult =
  | { ok: true; reply: MessengerSavedReply }
  | { ok: false; reason: SavedReplyFailure; detail?: string }

const TITLE_MAX = 120

async function adminOfEnabledAgency() {
  const user = await requireAgencyUser()
  if (!isFacebookMessengerEnabledForAgency(user.agencyId)) return { reason: 'not_enabled' as const }
  if (!isAdmin(user.role as Roles)) return { reason: 'forbidden' as const }
  return { user }
}

/** Rebuild from scratch — never trust the posted object's shape. */
function sanitize(raw: unknown): { input: SavedReplyInput } | { reason: SavedReplyFailure; detail?: string } {
  const r = (raw ?? {}) as Record<string, unknown>
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, TITLE_MAX) : ''
  if (!title) return { reason: 'invalid', detail: 'צריך שם לתשובה השמורה' }

  const body = typeof r.body === 'string' ? r.body.slice(0, MESSENGER_TEXT_MAX) : ''

  const quickReplies: MessengerQuickReply[] = Array.isArray(r.quickReplies)
    ? r.quickReplies
        .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
        .map((q) => ({
          title: typeof q.title === 'string' ? q.title.trim() : '',
          payload: typeof q.payload === 'string' && q.payload.trim() ? q.payload.trim() : '',
        }))
        .filter((q) => q.title)
    : []

  const buttons: MessengerButton[] = Array.isArray(r.buttons)
    ? r.buttons
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map((b) => {
          const btnTitle = typeof b.title === 'string' ? b.title.trim() : ''
          if (b.type === 'web_url') {
            return { type: 'web_url' as const, title: btnTitle, url: typeof b.url === 'string' ? b.url.trim() : '' }
          }
          const payload = typeof b.payload === 'string' && b.payload.trim() ? b.payload.trim() : btnTitle
          return { type: 'postback' as const, title: btnTitle, payload }
        })
        .filter((b) => b.title)
    : []

  const url = typeof r.attachmentUrl === 'string' ? r.attachmentUrl.trim() : ''
  // The asset type is DERIVED from what the admin declared, not from the URL's
  // extension — a `.jpg` in a query string is not evidence of anything.
  const declared = typeof r.attachmentType === 'string' ? r.attachmentType : ''
  const attachmentType: MessengerSendableType | null = url
    ? (['image', 'video', 'audio', 'file'].includes(declared) ? (declared as MessengerSendableType) : messengerAssetType(''))
    : null

  const input: SavedReplyInput = {
    title,
    body,
    quickReplies,
    buttons,
    attachmentUrl: url || null,
    attachmentType,
  }

  // A reply that would send nothing is a dead entry in the picker.
  if (!body.trim() && !input.attachmentUrl && buttons.length === 0) {
    return { reason: 'empty', detail: 'תשובה שמורה חייבת לכלול טקסט או קובץ מצורף' }
  }

  const check = validateRichContent(asContent(input))
  if ('error' in check) return { reason: 'invalid', detail: check.error }

  return { input }
}

export async function createSavedReply(raw: unknown): Promise<SavedReplyResult> {
  const auth = await adminOfEnabledAgency()
  if ('reason' in auth) return { ok: false, reason: auth.reason }

  const sanitized = sanitize(raw)
  if ('reason' in sanitized) return { ok: false, reason: sanitized.reason, detail: sanitized.detail }

  if ((await countMessengerSavedReplies(auth.user.agencyId)) >= SAVED_REPLY_LIMIT) {
    return { ok: false, reason: 'too_many' }
  }

  const reply = await createMessengerSavedReply(auth.user.agencyId, auth.user.id, sanitized.input)
  if (!reply) return { ok: false, reason: 'title_taken' }
  revalidatePath('/settings/integrations')
  revalidatePath('/inbox/messenger')
  return { ok: true, reply }
}

export async function updateSavedReply(id: number, raw: unknown): Promise<SavedReplyResult> {
  const auth = await adminOfEnabledAgency()
  if ('reason' in auth) return { ok: false, reason: auth.reason }

  const sanitized = sanitize(raw)
  if ('reason' in sanitized) return { ok: false, reason: sanitized.reason, detail: sanitized.detail }

  const existing = await getMessengerSavedReply(auth.user.agencyId, Number(id))
  if (!existing) return { ok: false, reason: 'not_found' }

  const reply = await updateMessengerSavedReply(auth.user.agencyId, Number(id), sanitized.input)
  if (!reply) return { ok: false, reason: 'title_taken' }
  revalidatePath('/settings/integrations')
  revalidatePath('/inbox/messenger')
  return { ok: true, reply }
}

export async function deleteSavedReply(id: number): Promise<{ ok: boolean; reason?: SavedReplyFailure }> {
  const auth = await adminOfEnabledAgency()
  if ('reason' in auth) return { ok: false, reason: auth.reason }
  const deleted = await deleteMessengerSavedReply(auth.user.agencyId, Number(id))
  if (!deleted) return { ok: false, reason: 'not_found' }
  revalidatePath('/settings/integrations')
  revalidatePath('/inbox/messenger')
  return { ok: true }
}
