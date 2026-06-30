/**
 * Executive Synthesis — Cluster detector (C2, v1.0).
 *
 * Pure, deterministic. Groups Business States by kind and emits one cluster
 * Candidate per kind present. The "size" of a cluster is its TRUE count
 * (metadata.clusterSize), while memberRefIds carry the sampled evidence. It does
 * not rank, gate, suppress, or read previous state — those are downstream.
 */
import type { BusinessState, BusinessStateKind } from '../businessState'
import type { Candidate } from './types'

/** v1.0 placeholder: cluster materiality uses scale + support only; deviation is inert. */
const V1_DEVIATION = 0

/** Fixed enumeration order → deterministic candidate ordering (never Map/object order). */
const KINDS: BusinessStateKind[] = ['BROKEN_COMMITMENT', 'FOLLOWUP_DUE', 'GOING_COLD', 'NEW_LEAD', 'WAITING_CUSTOMER']

export function detectClusters(states: BusinessState[]): Candidate[] {
  if (states.length === 0) return []

  // Shared denominator for scale: the true total across every category present.
  const total = KINDS.reduce((sum, kind) => {
    const first = states.find((s) => s.state === kind)
    return sum + (first ? first.metadata.clusterSize : 0)
  }, 0)
  if (total <= 0) return []

  const candidates: Candidate[] = []
  for (const kind of KINDS) {
    const members = states.filter((s) => s.state === kind)
    if (members.length === 0) continue
    const clusterSize = members[0].metadata.clusterSize // all members of a kind share the true total
    candidates.push({
      category: 'cluster',
      condition: kind, // the grouping key already in hand — no new computation
      memberRefIds: members.map((s) => s.refId).sort((a, b) => a.localeCompare(b)),
      scale: clusterSize / total,
      deviation: V1_DEVIATION,
      support: clusterSize,
    })
  }
  return candidates
}
