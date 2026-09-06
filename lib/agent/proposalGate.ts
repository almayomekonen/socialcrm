import type { EvidenceCollector } from './evidence'
import type { ProposedAction } from './types'

/**
 * An action may only target a lead the investigation actually saw.
 *
 * THE FAILURE THIS PREVENTS is the same one the citation contract was built for,
 * one layer further along and considerably more expensive. A model that invents
 * a lead id in a CLAIM has that claim destroyed and the rep sees a weaker
 * answer. A model that invents a lead id in an ACTION would, once approved, put
 * a real task on a real stranger's record — or, if the id belongs to another
 * tenant, be caught only by the executor's own tenant check, which is a last
 * line of defence rather than the intended one.
 *
 * So the same rule applies: the target must appear in the EvidenceCollector for
 * THIS run, which only tools write to. There is no path from a number the model
 * produced to an action, unless a tool returned that number first.
 *
 * DROPPING, NOT REFUSING. An ungrounded proposal is removed and the answer is
 * still shown. The prose is judged on its own evidence by the claim gate; losing
 * the action does not make the sentences around it untrue, and refusing the
 * whole answer would tell a rep nothing about a question that may have been
 * answered perfectly well.
 */
export function groundedProposal(
  proposal: ProposedAction | null | undefined,
  evidence: EvidenceCollector,
): ProposedAction | null {
  if (!proposal) return null
  if (proposal.actionType !== 'create_task') return null

  const clientId = proposal.args?.clientId
  if (!Number.isInteger(clientId) || clientId <= 0) return null

  // The one check that matters: a tool returned this lead during this run.
  if (!evidence.has('lead', String(clientId))) return null

  return proposal
}
