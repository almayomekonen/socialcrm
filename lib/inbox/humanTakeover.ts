/**
 * WhatsApp Agent — human takeover, recorded at the moment the rep sends.
 *
 * Typing pauses the agent; SENDING ends its autonomy on that conversation.
 * HUMAN_ACTIVE is permanent by design: once a rep has spoken to the customer in
 * their own words, an autonomous follow-up is no longer assistance, it is a
 * second voice on the line.
 *
 * WHY BEFORE THE GRAPH CALL, NOT AFTER. The takeover is recorded before the
 * outbound leaves for Meta, because the window we are protecting is exactly the
 * round trip: a worker that reads presence while the rep's message is in flight
 * must already see HUMAN_ACTIVE. The cost of marking early is that a send which
 * Meta then rejects still stops the agent — which is the correct direction. The
 * rep is sitting in the composer; they own the conversation whether or not that
 * particular attempt succeeded.
 *
 * BEST EFFORT, NEVER BLOCKING. A failure here is logged and swallowed: presence
 * bookkeeping must not stop a human from talking to their customer. The agent
 * stays safe anyway — the composer's typing signal has already parked it, and
 * the worker independently derives takeover from the human-authored outbound in
 * the transcript.
 */
import { db } from '@/config/db'
import { markHumanActiveByConversation } from '@/db/conversationHumanPresence'

/**
 * @param conversationId The conversation the rep is replying in, when known.
 *   When null (lead-page send with no open thread) the newest WhatsApp
 *   conversation for the lead is used — the same row `resolveWhatsappOutboundTarget`
 *   would send from, so takeover always lands on the conversation that received
 *   the message.
 */
export async function recordHumanTakeover(args: {
  agencyId: number
  leadId: number
  conversationId?: number | null
}): Promise<{ conversationId: number | null }> {
  try {
    const conversationId = args.conversationId ?? (await newestWhatsappConversation(args.agencyId, args.leadId))
    if (conversationId == null) return { conversationId: null }
    // markHumanActiveByConversation is agency-scoped in SQL: a conversation
    // belonging to another agency writes nothing and reports false.
    const marked = await markHumanActiveByConversation(conversationId, args.agencyId)
    return { conversationId: marked ? conversationId : null }
  } catch (err) {
    console.error('[human-takeover] failed to mark human_active', {
      leadId: args.leadId,
      conversationId: args.conversationId ?? null,
      err: String(err),
    })
    return { conversationId: null }
  }
}

async function newestWhatsappConversation(agencyId: number, leadId: number): Promise<number | null> {
  const conv = await db('inbox_conversations')
    .where({ leadId, agencyId, channel: 'whatsapp' })
    .orderByRaw('"lastMessageAt" DESC NULLS LAST')
    .orderBy('id', 'desc')
    .first('id')
  return conv?.id == null ? null : Number(conv.id)
}
