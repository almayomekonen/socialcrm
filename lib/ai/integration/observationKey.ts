import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'

/**
 * Observation identity — the deterministic key a signal job is stored under.
 *
 * `signal_jobs`'s unique index is ("agencyId","observationKey") and the enqueue
 * is `ON CONFLICT DO NOTHING`. Two consequences follow, and both are the reason
 * this module exists — they are the same two `lib/notifications/eventKey.ts`
 * documents for `notification_jobs."eventKey"`:
 *
 *   1. Re-detection is absorbed for free. A sweep that runs every minute
 *      re-observes the same overdue follow-up sixty times an hour and creates
 *      one job.
 *   2. A sweep is therefore safe to run forever: re-enqueueing a known
 *      observation is a no-op, so work lost to a crash between detection and
 *      the job INSERT gets picked up on the next pass instead of never.
 *
 * Because the index carries the agency, the key itself does not need to — but
 * it DOES need its own namespace across expectations and subjects, or two
 * different observations about one lead would collide and the second would
 * silently vanish.
 *
 * DETERMINISTIC AND PURE. Never `Date.now()`, never random, never the detection
 * instant. A key that varied per call would defeat both properties above — the
 * queue would fill with one job per sweep tick.
 *
 * WHAT MAKES AN OBSERVATION "THE SAME". The violated expectation, the subject,
 * and the MOMENT THE EXPECTATION NAMED — not the moment it was noticed. For
 * `followup.overdue` that is `absence.expectedBy`: while the follow-up date is
 * unchanged, every re-detection is the same missed deadline. Reschedule it and
 * the deadline changes, so the key changes, and the new miss is new work. This
 * is exactly the rule `followupAtEventKey` already applies to follow-up
 * notifications (`at:{followUpAt}`), and `integrationDisconnectedEventKey` to
 * an episodic disconnect (`at:{disconnectedAt}`).
 */

/** A signal that cannot be identified cannot be stored. */
export class UnidentifiableSignalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnidentifiableSignalError'
  }
}

function requireSubject(signal: ExternalSignal): { subjectType: string; subjectId: string } {
  const subject = signal.subject
  if (!subject || !subject.subjectType || !subject.subjectId) {
    throw new UnidentifiableSignalError('a queued signal must name a subject')
  }
  return { subjectType: String(subject.subjectType), subjectId: String(subject.subjectId) }
}

/**
 * The expectation an absence signal violated. This is the signal's own
 * `violatedExpectation` — the detector's registry entry name — not a value this
 * module invents.
 */
export function expectationOf(signal: ExternalSignal): string {
  if (signal.signalType === 'absence') {
    const violated = signal.absence?.violatedExpectation
    if (typeof violated !== 'string' || violated.length === 0) {
      throw new UnidentifiableSignalError('an absence signal must carry a violated expectation')
    }
    return violated
  }
  return signal.signalType
}

/**
 * The moment the expectation named, as the discriminator. For absence that is
 * the deadline that passed; for any other signal type the occurrence instant,
 * which for a real trace IS the observation's own identity.
 */
function discriminatorOf(signal: ExternalSignal): string {
  if (signal.signalType === 'absence') {
    const expectedBy = signal.absence?.expectedBy
    if (typeof expectedBy === 'string' && expectedBy.length > 0) return `at:${expectedBy}`
    // No named deadline: fall back to the moment the expectation was violated,
    // which for an absence marker is the last signal seen. Never the clock.
    const since = signal.absence?.sinceLastSignalAt
    if (typeof since === 'string' && since.length > 0) return `since:${since}`
    throw new UnidentifiableSignalError('an absence signal must carry expectedBy or sinceLastSignalAt to be identifiable')
  }
  const refs = signal.traceRefs ?? []
  if (refs.length > 0) return refs.map((r) => `${r.type}:${r.id}`).join(',')
  throw new UnidentifiableSignalError(`a '${signal.signalType}' signal must reference at least one trace`)
}

/** The deterministic identity of one observation. Pure; throws rather than guessing. */
export function observationKeyFor(signal: ExternalSignal): string {
  const { subjectType, subjectId } = requireSubject(signal)
  return `${expectationOf(signal)}:${subjectType}:${subjectId}:${discriminatorOf(signal)}`
}
