'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { db } from '@/config/db'
import { canUseWhatsappQuestionnaire } from '@/lib/flags/whatsappQuestionnaireFlags'
import { parseQuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import {
  canSwitchResponder,
  normaliseResponder,
  resolveResponderChoice,
  type ResponderKind,
} from '@/lib/inbox/autoresponse/responderChoice'

export type SetResponderInput = {
  /** The method to make active. */
  to: ResponderKind
  /** The method the page showed as stored. A different stored value is a conflict, never an overwrite. */
  from: ResponderKind
}

export type SetResponderResult =
  | { ok: true; responder: ResponderKind }
  | { ok: false; reason: 'forbidden' | 'invalid' | 'no_settings' | 'conflict' | 'unavailable' }

const CHANNEL = 'whatsapp'
const KINDS: readonly ResponderKind[] = ['agent', 'questionnaire']

/**
 * The owner's choice between the AI conversational agent and the structured
 * questionnaire for WhatsApp.
 *
 * Writes ONE column, `auto_response_settings.responder`, for the signed-in
 * admin's own agency. Nothing else: not `mode`, `replyMode`, the questionnaire
 * definition, its revisions or drafts, the agent profile, sessions, the master
 * switch or any rollout flag. What happens to a conversation already in
 * progress is the workers' existing rule (an open questionnaire session is
 * handed to a person on its next turn; it is never handed to the AI).
 *
 * Eligibility is decided again here from the row as it is inside the
 * transaction (resolveResponderChoice), so a stale page cannot switch an agency
 * to a method it cannot run. `from` makes the write a compare-and-set: a second
 * tab or a double submission that no longer matches the stored value is refused.
 */
export async function setAutoResponseResponder(input: SetResponderInput): Promise<SetResponderResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }
  if (!KINDS.includes(input?.to) || !KINDS.includes(input?.from) || input.to === input.from) {
    return { ok: false, reason: 'invalid' }
  }
  const agencyId = user.agencyId

  return db.transaction(async (trx) => {
    const row = await trx('auto_response_settings')
      .where({ agencyId, channel: CHANNEL })
      .forUpdate()
      .first('responder', 'mode', 'replyMode', 'questionnaire')
    if (!row) return { ok: false, reason: 'no_settings' } as const
    if (normaliseResponder(row.responder) !== input.from) return { ok: false, reason: 'conflict' } as const

    const choice = resolveResponderChoice({
      responder: row.responder,
      mode: row.mode,
      replyMode: row.replyMode,
      questionnaireAllowed: canUseWhatsappQuestionnaire(agencyId),
      questionnairePublished: parseQuestionnaireDefinition(row.questionnaire ?? null).ok,
    })
    if (!canSwitchResponder(choice, input.to)) return { ok: false, reason: 'unavailable' } as const

    await trx('auto_response_settings')
      .where({ agencyId, channel: CHANNEL })
      .update({ responder: input.to, updatedBy: user.id, updatedAt: trx.fn.now() })
    return { ok: true, responder: input.to } as const
  }).then((result) => {
    if (result.ok) revalidatePath('/settings/auto-response')
    return result
  })
}
