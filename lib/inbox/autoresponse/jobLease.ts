import { randomUUID } from 'node:crypto'
import { renewAutoResponseJobLease } from '@/db/autoResponseJobs'
import { clearSendStarted, markSendStarted } from '@/db/autoResponseSendMarker'
import type { SendWhatsappArgs } from '@/lib/whatsapp/sendMessage'
import { AUTOMATED_SEND_TIMEOUT_MS } from '@/lib/whatsapp/sendOutcome'

/**
 * Exclusive execution for one claimed auto-response job.
 *
 * The 60 s lease is shorter than a slow AI turn (summary + generation +
 * regeneration, each up to 45 s per provider), so without renewal another
 * worker's reclaim could hand a still-running job to a second worker: double
 * model calls and, at worst, a duplicate WhatsApp reply.
 *
 *   keepJobLease  renews `lockedAt` every lease/3 while the owner runs; a
 *                 worker that dies simply stops renewing, and the reclaim
 *                 recovers the job one lease later (as before).
 *   fencedSend    re-checks ownership immediately before the external side
 *                 effect AND records `sendStartedAt` in the same statement; a
 *                 worker that lost the job throws LeaseLostError and sends
 *                 nothing. The marker is committed before Meta is called, so a
 *                 crash after Meta accepted leaves the job parked, never resent.
 *                 It is cleared (owner-checked) only when nothing reached Meta.
 *   boundedSend   gives every Graph send a deadline well inside the lease and
 *                 the 60 s function limit, so a hung request ends as a
 *                 reported `ambiguous` outcome (parked, never resent) instead
 *                 of a killed worker whose job a reclaim later runs again.
 */

/** Bound one send. A caller's own `timeoutMs` (the questionnaire's) is kept. */
export function boundedSend<A extends Pick<SendWhatsappArgs, 'timeoutMs'>, R>(send: (args: A) => Promise<R>): (args: A) => Promise<R> {
  return (args: A) => send({ ...args, timeoutMs: args.timeoutMs ?? AUTOMATED_SEND_TIMEOUT_MS })
}

export class LeaseLostError extends Error {
  constructor(jobId: number) {
    super(`auto-response job ${jobId}: lease lost before send`)
    this.name = 'LeaseLostError'
  }
}

export type LeaseDeps = {
  renew?: typeof renewAutoResponseJobLease
  markSent?: typeof markSendStarted
  clearSent?: typeof clearSendStarted
}

/**
 * Nothing reached Meta: a Graph refusal (an answer, nothing delivered) or a
 * refusal before any request (the opt-out gate). An `ambiguous` failure is NOT
 * this — the message may be on the customer's phone. A thrown error is not
 * either: we cannot tell where it was thrown, so the marker stays (parked).
 */
function nothingReachedMeta(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const r = result as { ok?: unknown; ambiguous?: unknown }
  return r.ok === false && r.ambiguous !== true
}

export function keepJobLease(
  jobId: number,
  workerId: string,
  leaseMs: number,
  deps: LeaseDeps = {},
): { stop: () => void; lost: () => boolean } {
  const renew = deps.renew ?? renewAutoResponseJobLease
  let lost = false
  const timer = setInterval(
    () => {
      renew(jobId, workerId)
        .then((ok) => {
          if (!ok) lost = true
        })
        // A transient DB error: the next beat retries; the fence still guards the send.
        .catch(() => undefined)
    },
    Math.max(1_000, Math.floor(leaseMs / 3)),
  )
  timer.unref?.()
  return { stop: () => clearInterval(timer), lost: () => lost }
}

export function fencedSend<A, R>(
  send: (args: A) => Promise<R>,
  jobId: number,
  workerId: string,
  deps: LeaseDeps = {},
): (args: A) => Promise<R> {
  const mark = deps.markSent ?? markSendStarted
  const clear = deps.clearSent ?? clearSendStarted
  return async (args: A) => {
    if (!(await mark(jobId, workerId))) throw new LeaseLostError(jobId)
    const result = await send(args)
    // Clear only what this worker still owns. Lost meanwhile: the job is another
    // worker's now, so stop here and touch nothing (nothing was delivered).
    if (nothingReachedMeta(result) && !(await clear(jobId, workerId))) throw new LeaseLostError(jobId)
    return result
  }
}

/**
 * Stops further AI work once the heartbeat has seen the lease lost (no
 * database read: `lost()` is the heartbeat's own flag). The job belongs to
 * another worker; generating for it would only spend a provider call whose
 * reply the send fence would then refuse to deliver.
 */
export function leaseGuard<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  jobId: number,
  lost: () => boolean,
): (...args: Args) => Promise<R> {
  return (...args: Args) => {
    if (lost()) return Promise.reject(new LeaseLostError(jobId))
    return fn(...args)
  }
}

/**
 * A worker id unique per invocation: the lease fence compares `lockedBy`, and
 * pid + millisecond alone can repeat across serverless instances.
 */
export const newWorkerId = (prefix: string): string => `${prefix}-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`
