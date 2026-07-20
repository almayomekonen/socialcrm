// Today brief — progress / finish line (INV-12, INV-13, INV-14). Pure.
// handledToday is a set difference: touched-today MINUS still-qualifying, so a
// lead that was touched but still needs attention is never counted as handled.
// Meetings are never passed in, so they cannot affect any of these numbers.

import { HIGH_VOLUME_THRESHOLD } from './constants'
import type { VolumeState } from './types'

export function progress({
  qualifyingIds,
  touchedTodayIds,
}: {
  qualifyingIds: readonly number[]
  touchedTodayIds: readonly number[]
}): { remaining: number; handledToday: number; done: boolean } {
  const qualifying = new Set(qualifyingIds)
  const remaining = qualifying.size
  let handledToday = 0
  const seen = new Set<number>()
  for (const id of touchedTodayIds) {
    if (seen.has(id)) continue // de-dupe touched ids so handled is a true count
    seen.add(id)
    if (!qualifying.has(id)) handledToday++
  }
  return { remaining, handledToday, done: remaining === 0 }
}

export function volumeStateFor(remaining: number): VolumeState {
  if (remaining === 0) return 'clear'
  return remaining > HIGH_VOLUME_THRESHOLD ? 'busy' : 'normal'
}
