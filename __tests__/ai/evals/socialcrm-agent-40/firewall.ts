/**
 * THE MUTATION FIREWALL — proof that measuring the agent did not change the CRM.
 *
 * All forty questions are intelligence-only. None asks for a task, a follow-up
 * or a meeting, so a single new row in any of these tables means the agent wrote
 * something nobody asked for — the exact failure the authorization model exists
 * to prevent, and one that a benchmark measuring only answer quality would miss
 * entirely.
 *
 * ON A BREACH THE RUN FAILS. It does not restore the rows and report success —
 * a firewall that repairs the evidence is not a firewall. `report.ts` ranks a
 * breach above every other failure, because an evaluation that changed the data
 * it was measuring has invalidated its own numbers, whatever they say.
 *
 * PURE ON PURPOSE. The counting query lives in `crmCounts.ts` so that this
 * file — and the CI test that exercises it — never imports the database.
 */
export type CrmCounts = {
  tasks: number
  followUps: number
  meetings: number
  agentActions: number
  agentActionApprovals: number
}

export type FirewallVerdict = {
  ok: boolean
  before: CrmCounts
  after: CrmCounts
  /** Every table that moved, with both numbers. Empty when the firewall held. */
  breaches: { table: keyof CrmCounts; before: number; after: number }[]
}

export function compareCounts(before: CrmCounts, after: CrmCounts): FirewallVerdict {
  const keys = Object.keys(before) as (keyof CrmCounts)[]
  const breaches = keys.filter((k) => before[k] !== after[k]).map((k) => ({ table: k, before: before[k], after: after[k] }))
  return { ok: breaches.length === 0, before, after, breaches }
}
