import { ownsAutoResponseJob, renewAutoResponseJobLease } from '@/db/autoResponseJobs'

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
 *                 effect; a worker that lost the job throws LeaseLostError
 *                 and sends nothing.
 */

export class LeaseLostError extends Error {
  constructor(jobId: number) {
    super(`auto-response job ${jobId}: lease lost before send`)
    this.name = 'LeaseLostError'
  }
}

export type LeaseDeps = {
  renew?: typeof renewAutoResponseJobLease
  owns?: typeof ownsAutoResponseJob
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
  const owns = deps.owns ?? ownsAutoResponseJob
  return async (args: A) => {
    if (!(await owns(jobId, workerId))) throw new LeaseLostError(jobId)
    return send(args)
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
