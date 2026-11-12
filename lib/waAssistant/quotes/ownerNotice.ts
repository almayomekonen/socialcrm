import 'server-only'
import { db } from '@/config/db'
import { platformWhatsappAccessToken, platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { sendPlatformText } from '@/lib/whatsapp/platform/sendText'
import { resolveAssistantScope, type ScopeResolution } from '../identity'

/**
 * The owner who tapped the card for `actionId`, as the verified assistant
 * recipient they are now. Null when that card was never approved or the
 * recipient, the user or the assistant is no longer active: then nobody is told
 * anything and nothing is sent on their authority.
 */
export async function approvingOwner(agencyId: number, actionId: string): Promise<Extract<ScopeResolution, { ok: true }> | null> {
  const approval = (await db('wa_assistant_approvals').where({ agencyId, actionId, status: 'approved' }).first('recipientId', 'userId')) as { recipientId: number; userId: number } | undefined
  if (!approval) return null
  const who = await resolveAssistantScope({ recipientId: Number(approval.recipientId), agencyId, userId: Number(approval.userId) }, new Date())
  return who.ok === true ? who : null
}

/** One message to that owner on the platform number. The caller claims "exactly once" itself. */
export async function tellApprovingOwner(input: { agencyId: number; actionId: string; body: string; jobId: number; owner?: Extract<ScopeResolution, { ok: true }> | null }): Promise<void> {
  const phoneNumberId = platformWhatsappPhoneNumberId()
  const accessToken = platformWhatsappAccessToken()
  if (!phoneNumberId || !accessToken) return
  const who = input.owner === undefined ? await approvingOwner(input.agencyId, input.actionId) : input.owner
  if (!who) return
  await sendPlatformText({ phoneNumberId, accessToken, toE164: who.phoneE164, body: input.body, jobId: input.jobId })
}
