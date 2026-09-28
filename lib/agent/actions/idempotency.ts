import { createHash } from 'node:crypto'

/**
 * Idempotency — the difference between one follow-up and five.
 *
 * THE FAILURE THIS PREVENTS is not a model that asks twice. It is the ordinary
 * distributed-systems one: a mutation commits, the response is lost to a socket
 * reset or a 40-second deadline, and whatever retries — the SDK, the browser, a
 * worker — issues the identical request against a database that has already
 * changed. Without a durable key the second attempt is indistinguishable from a
 * first, and the rep gets two of everything.
 *
 * THE KEY IS DERIVED, NOT GENERATED. A random per-attempt id would be unique on
 * every retry, which is the one property an idempotency key must not have. It is
 * a digest of what makes the action the SAME logical action: the agency, the
 * type, and the exact arguments.
 *
 * SCOPED BY AGENT RUN, BY DEFAULT, and this is the deliberate trade-off worth
 * stating. Including `agentRunId` means every retry inside one investigation
 * collapses to one mutation, while the same request made again tomorrow is a new
 * one — because it is: the rep asked again, about a business that has moved.
 * Omitting it would make "create a follow-up for דוד tomorrow" permanently
 * un-repeatable, which is a product decision this layer has no right to make.
 * A caller that genuinely wants cross-run deduplication passes an explicit key.
 *
 * CANONICALISATION IS PART OF THE CONTRACT. `{a:1,b:2}` and `{b:2,a:1}` are the
 * same action, and a model does not emit keys in a stable order, so a hash over
 * raw JSON would let key ordering alone create a duplicate mutation.
 */

/**
 * Deterministic JSON: object keys sorted at every depth, arrays left in order
 * because their order is meaning. `undefined` members are dropped so an
 * explicitly-absent field and a missing one hash alike.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const out: Record<string, unknown> = {}
  for (const [k, v] of entries) out[k] = canonicalize(v)
  return out
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value) ?? null)
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * The digest an approval is bound to.
 *
 * Separate from the idempotency key on purpose: the key answers "is this the
 * same attempt", the args hash answers "is this the same thing the human said
 * yes to". They must not be the same value, because a plan-level approval covers
 * several actions whose keys all differ.
 */
export function hashArgs(args: Record<string, unknown>): string {
  return sha256(canonicalJson(args)).slice(0, 32)
}

export type IdempotencyKeyInput = {
  agencyId: number
  actionType: string
  args: Record<string, unknown>
  /** Scopes deduplication to one investigation. Omit only with an explicit key. */
  agentRunId?: string | null
}

export function deriveIdempotencyKey(input: IdempotencyKeyInput): string {
  const material = canonicalJson({
    agencyId: input.agencyId,
    actionType: input.actionType,
    agentRunId: input.agentRunId ?? null,
    args: input.args,
  })
  return sha256(material).slice(0, 48)
}

/**
 * What a second attempt on an existing claim is allowed to do.
 *
 * The whole state machine, in one place, because scattering it across the
 * runtime is how "just retry it" quietly gets added to the UNKNOWN branch.
 */
export type ClaimDecision =
  /** Nothing ran. Proceed. */
  | { kind: 'PROCEED' }
  /** It ran and succeeded. Report the original outcome; execute nothing. */
  | { kind: 'ALREADY_EXECUTED' }
  /** A twin is running RIGHT NOW. Execute nothing; it is not started twice. */
  | { kind: 'IN_FLIGHT' }
  /** It definitively did not happen, so doing it now cannot duplicate anything. */
  | { kind: 'RETRY_ALLOWED' }
  /**
   * We cannot tell. Never re-execute: a retry here is precisely how one lost
   * response becomes two records. A human or a reconciler resolves it.
   */
  | { kind: 'RECONCILE' }

export type ExistingClaim = {
  executionState: string
  /** When the row was last written. Decides whether EXECUTING is alive or dead. */
  updatedAtMs?: number
  /** Set when a prior attempt declared its failure definitive. */
  retryable?: boolean | null
}

/**
 * How long an execution may hold its claim before it is presumed abandoned.
 *
 * The agent's absolute wall-clock deadline is 40s (`DEFAULT_DEADLINE_MS`), and
 * an executor runs inside it, so nothing legitimate can still be executing a
 * minute later. The margin is deliberate: guessing too SHORT would declare a
 * slow-but-healthy mutation abandoned and route a perfectly good action to
 * reconciliation, while guessing too long only delays a reconciliation that a
 * human performs anyway.
 */
export const EXECUTION_LEASE_MS = 60_000

export function decideOnExistingClaim(existing: ExistingClaim | null, nowMs = Date.now()): ClaimDecision {
  if (!existing) return { kind: 'PROCEED' }

  switch (existing.executionState) {
    case 'SUCCEEDED':
      return { kind: 'ALREADY_EXECUTED' }
    // A clean failure is a fact about the world: the mutation did not land.
    case 'FAILED':
      return { kind: 'RETRY_ALLOWED' }
    // Never executed — approval refused, policy refused, deadline passed.
    case 'NOT_EXECUTED':
      return { kind: 'RETRY_ALLOWED' }
    /**
     * PENDING means the claim was taken but the executor has NOT been reached —
     * the runtime writes EXECUTING immediately before calling it, so a row in
     * this state provably mutated nothing.
     *
     * Inside the lease, that is a twin mid-flight between claiming and
     * executing: milliseconds old, about to proceed, and not to be started
     * again. Past the lease, the process died in that gap — and because no
     * executor ran, a retry cannot duplicate anything. This is the one abandoned
     * state that is safe to resume, and saying so keeps it out of a
     * reconciliation queue that must stay small enough to read.
     */
    case 'PENDING': {
      const claimedAt = existing.updatedAtMs
      if (claimedAt != null && nowMs - claimedAt < EXECUTION_LEASE_MS) return { kind: 'IN_FLIGHT' }
      return { kind: 'RETRY_ALLOWED' }
    }
    /**
     * EXECUTING means one of two very different things, and TIME is what tells
     * them apart.
     *
     * Inside the lease, a twin is running this instant — two duplicate requests
     * that raced, which is the ordinary case and not a problem: the claim did
     * its job, exactly one execution is happening, and the row will resolve in
     * milliseconds. Calling that "unknown" would fill the reconciliation queue
     * with healthy actions and make the one row that genuinely needs a human
     * impossible to find.
     *
     * Past the lease, nothing can still legitimately be running, so the process
     * that held the claim died mid-mutation. That IS the ambiguous case, and it
     * is never optimistically read as "probably did not finish".
     */
    case 'EXECUTING': {
      const startedAt = existing.updatedAtMs
      if (startedAt != null && nowMs - startedAt < EXECUTION_LEASE_MS) return { kind: 'IN_FLIGHT' }
      return { kind: 'RECONCILE' }
    }
    case 'UNKNOWN':
      return { kind: 'RECONCILE' }
    default:
      return { kind: 'RECONCILE' }
  }
}
