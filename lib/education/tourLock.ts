/**
 * Process-local lock so two tours cannot initialize at once (AutoTour + ?tour=,
 * React Strict Mode double-effect, overlapping maybeStart).
 */

let locked = false

export function acquireTourLock(): boolean {
  if (locked) return false
  locked = true
  return true
}

export function releaseTourLock(): void {
  locked = false
}

export function isTourLockHeld(): boolean {
  return locked
}

/** Test-only. */
export function __resetTourLockForTests(): void {
  locked = false
}
