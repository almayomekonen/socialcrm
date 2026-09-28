import { MAX_BATCH_TARGETS } from './actions/batchLimits'
import type { EvidenceCollector } from './evidence'
import type { ProposedBatch } from './types'

/**
 * A batch may only target leads the investigation actually saw.
 *
 * THE SAME RULE AS `groundedProposal`, and it matters more here for an obvious
 * reason: a hallucinated lead id in a single action puts one task on one
 * stranger's record, and in a batch it does that N times. So every target is
 * checked against the EvidenceCollector for THIS run, which only tools write to.
 *
 * A PARTIAL SET IS REFUSED, NOT TRIMMED. Silently dropping the ungrounded ids
 * and running the rest would execute a batch the rep never saw described: they
 * asked about "all the leads with no next step", and quietly acting on a subset
 * is a different instruction. If any target is unaccounted for, the whole batch
 * is dropped and the prose stands on its own.
 *
 * THE SIZE BOUND IS NOT ENFORCED HERE. Over-limit is a real answer the rep
 * should be given ("47 match, narrow it"), not a silent removal — so it is
 * decided in `expandBatch`, which can report it. This gate only decides whether
 * the batch is grounded enough to be considered at all.
 */
export function groundedBatch(
  batch: ProposedBatch | null | undefined,
  evidence: EvidenceCollector,
): ProposedBatch | null {
  if (!batch) return null
  if (batch.actionType !== 'create_task') return null
  if (!Array.isArray(batch.targets) || batch.targets.length === 0) return null
  // A model that emits an absurd list is refused before anything is looked up.
  if (batch.targets.length > MAX_BATCH_TARGETS * 10) return null

  const seen = new Set<number>()
  for (const id of batch.targets) {
    if (!Number.isInteger(id) || id <= 0) return null
    // A duplicate target would create two identical tasks for one lead.
    if (seen.has(id)) return null
    seen.add(id)
    if (!evidence.has('lead', String(id))) return null
  }

  return { ...batch, targets: [...seen] }
}
