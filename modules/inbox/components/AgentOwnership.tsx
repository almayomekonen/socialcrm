import { requireAgencyUser } from '@/lib/requireUser'
import { getAiState } from '@/db/conversationAiState'
import { getChannelSettings, getMasterEnabled } from '@/db/autoResponseSettings'
import { isHumanOwned } from '@/lib/inbox/autoresponse/agentOwnership'
import AgentOwnershipClient from './AgentOwnershipClient'

/**
 * Who is answering this conversation — the agent, or a person.
 *
 * SILENT BY DEFAULT. Renders nothing unless Automatic Reply is actually on for
 * this agency and channel. An owner who does not use the agent never sees a
 * control for it, and nothing about their inbox changes.
 *
 * It is also silent while the agent is working normally AND has never spoken
 * here: there is nothing to report and no decision to offer. The line appears
 * when it carries information — the agent is handling this thread, or a person
 * has it and the agent is waiting.
 */
export default async function AgentOwnership({ conversationId }: { conversationId: number }) {
  const user = await requireAgencyUser().catch(() => null)
  if (!user?.agencyId) return null

  const [master, settings, state] = await Promise.all([
    getMasterEnabled(user.agencyId).catch(() => false),
    getChannelSettings(user.agencyId, 'whatsapp').catch(() => null),
    getAiState(conversationId).catch(() => null),
  ])
  if (!master || !settings?.enabled) return null
  if (!state || state.agencyId !== user.agencyId) return null

  const humanOwned = isHumanOwned(state.aiState)
  // The customer's own stop, and a finished conversation. Neither offers a
  // decision: there is no control that should resume them.
  if (state.aiState === 'opted_out' || state.aiState === 'closed') return null
  // The agent is active but has never spoken here. Nothing has happened yet.
  if (!humanOwned && state.aiTurnCount === 0) return null

  return (
    <AgentOwnershipClient
      conversationId={conversationId}
      humanOwned={humanOwned}
      handedOff={state.aiState === 'escalated'}
    />
  )
}
