import type { Knex } from 'knex'
import { hasEverOptedOut, hasOtherInboundInLastDay } from '@/db/platformWhatsappInbound'
import { isWaAssistantAgency, isWaAssistantSenderGuidanceEnabled } from '@/lib/flags/waAssistantFlags'
import { COPY } from '@/lib/waAssistant/render'
import type { SenderMatch } from '@/lib/waAssistant/identity'

/**
 * What a sender the assistant CANNOT answer is told, instead of silence.
 *
 *   none       not a verified, active recipient (unknown, pending, suspended,
 *              removed): "connect this number" + where
 *   ambiguous  verified for several accounts, so whose data to read is unknown:
 *              "keep it connected to one account" (the sender verified every one
 *              of those accounts from this same phone, so this tells them only
 *              about themselves)
 *   match, assistant not enabled for that agency: the existing `notAvailable`
 *
 * Never: a sender who EVER opted out (silence stays silence); a second reply to
 * the same sender within 24 hours (only their first message in a day gets one);
 * any CRM data, name or business. Each text is identical for every sender in its
 * case, so it never says whether a number belongs to anyone else.
 *
 * Decided INSIDE the per-sender platform transaction (advisory lock + the
 * message-id record), so a redelivery or a concurrent second message cannot
 * produce a second reply. Off unless WA_ASSISTANT_SENDER_GUIDANCE=1.
 */

export type SenderGuidance = { kind: 'not_connected' | 'several_accounts' | 'not_available'; body: string }

export async function decideSenderGuidance(
  trx: Knex.Transaction,
  input: { fromHash: string | null; wamid: string; match: SenderMatch },
): Promise<SenderGuidance | null> {
  if (!isWaAssistantSenderGuidanceEnabled() || !input.fromHash) return null
  const { match } = input
  const guidance: SenderGuidance | null =
    match.kind === 'none'
      ? { kind: 'not_connected', body: COPY.notConnected }
      : match.kind === 'ambiguous'
        ? { kind: 'several_accounts', body: COPY.severalAccounts }
        : isWaAssistantAgency(match.agencyId)
          ? null
          : { kind: 'not_available', body: COPY.notAvailable }
  if (!guidance) return null
  if (await hasEverOptedOut(trx, input.fromHash)) return null
  if (await hasOtherInboundInLastDay(trx, input.fromHash, input.wamid)) return null
  return guidance
}
