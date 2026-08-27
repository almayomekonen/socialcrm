/**
 * Recovery policy for failed Meta lead ingestion. PURE — no DB, no clock, no
 * network. The worker gathers facts and asks these functions what to do.
 *
 * The whole point of this module is to make "when do we retry, and when do we
 * stop" a decision that can be exhaustively tested without a database or a
 * Graph API, because getting it wrong in either direction is expensive:
 * retrying forever hammers Meta with requests that cannot succeed, and giving
 * up too early loses a lead the customer paid for.
 */

/** Error kinds the webhook records. Append-only — these are persisted values. */
export type WebhookFailureType = 'timeout' | 'fetch_error' | 'graph_api_error' | 'db_error' | 'unhandled_error' | 'token_expired'

export type FailureStatus = 'pending' | 'resolved' | 'dead'

/** Why a row reached its terminal state. Persisted; append-only. */
export type FailureResolution =
  | 'recovered' //        a retry created the lead
  | 'already_exists' //   the lead was already there (a redelivery had won)
  | 'max_attempts' //     we tried the full budget and stopped
  | 'needs_reconnect' //  the connection is dead; retrying cannot help
  | 'no_connection' //    the Page is no longer connected to any agency

/**
 * Is this failure worth another attempt?
 *
 * `token_expired` is the one that must NOT be retried. The token is dead until a
 * human walks the OAuth dialog again, so every retry is a guaranteed 401 —
 * exactly the "hammering Meta" behaviour a retry queue is supposed to avoid. It
 * already has its own recovery path: `markFacebookDisconnectedAndNotify` flips
 * the Page to `token_expired` and tells the customer to reconnect.
 *
 * Everything else is transient by nature: a timeout, a network error, a Graph
 * 5xx, a database blip, or an unhandled exception are all things that can
 * plausibly succeed on a second attempt minutes later.
 */
export function isRetryableFailure(errorType: string | null | undefined): boolean {
  return errorType !== 'token_expired'
}

/** Attempt budget. Five attempts across the schedule below spans ~9 hours. */
export const MAX_ATTEMPTS = 5

/**
 * Backoff before attempt N (1-indexed), in seconds.
 *
 * Deliberately coarse and long. A lost lead is recovered by minutes-to-hours,
 * not seconds, and a tight loop against Meta buys nothing while risking rate
 * limits on an app whose webhook subscription is load-bearing for every customer.
 *
 * 5m → 15m → 45m → 2h → 6h, then held at 6h.
 */
const SCHEDULE_SECONDS = [300, 900, 2_700, 7_200, 21_600] as const

export function backoffSeconds(attempts: number): number {
  const n = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0
  return SCHEDULE_SECONDS[Math.min(n, SCHEDULE_SECONDS.length - 1)]
}

export type AttemptOutcome =
  | { kind: 'recovered' }
  | { kind: 'already_exists' }
  | { kind: 'no_connection' }
  | { kind: 'needs_reconnect' }
  | { kind: 'transient'; error: string }

export type FailureDecision =
  | { status: 'resolved'; resolution: FailureResolution }
  | { status: 'dead'; resolution: FailureResolution }
  | { status: 'pending'; attempts: number; retryInSeconds: number }

/**
 * What to write back after one attempt.
 *
 * `attemptsSoFar` is the value BEFORE this attempt, so the caller stores
 * `decision.attempts` verbatim rather than incrementing twice — an off-by-one
 * here would either burn the budget early or retry forever.
 */
export function decideAfterAttempt(
  outcome: AttemptOutcome,
  attemptsSoFar: number,
  maxAttempts: number = MAX_ATTEMPTS,
): FailureDecision {
  // A lead that now exists is a resolved row, however it got there. A redelivery
  // winning the race is a success, not a failure to record.
  if (outcome.kind === 'recovered') return { status: 'resolved', resolution: 'recovered' }
  if (outcome.kind === 'already_exists') return { status: 'resolved', resolution: 'already_exists' }

  // Terminal without exhausting the budget: more attempts cannot change these.
  if (outcome.kind === 'needs_reconnect') return { status: 'dead', resolution: 'needs_reconnect' }
  if (outcome.kind === 'no_connection') return { status: 'dead', resolution: 'no_connection' }

  const attempts = (Number.isFinite(attemptsSoFar) ? Math.max(0, Math.floor(attemptsSoFar)) : 0) + 1
  const budget = Number.isFinite(maxAttempts) ? Math.max(1, Math.floor(maxAttempts)) : MAX_ATTEMPTS
  if (attempts >= budget) return { status: 'dead', resolution: 'max_attempts' }

  return { status: 'pending', attempts, retryInSeconds: backoffSeconds(attempts) }
}

/**
 * Should a human be told about this row?
 *
 * ONLY on `max_attempts` — the moment the system genuinely gave up on a lead it
 * believed was recoverable. The other terminal states already have their own,
 * better-targeted signal: `needs_reconnect` and `no_connection` are connection
 * problems, and `integration.disconnected` says so far more usefully than "one
 * lead failed". Notifying on those would be two alerts for one cause.
 *
 * Care charter Law 16: urgency must be real, rare and earned.
 */
export function shouldAlertOnTerminal(resolution: FailureResolution): boolean {
  return resolution === 'max_attempts'
}
