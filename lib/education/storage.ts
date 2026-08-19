import type { EducationState, TourId, TourRecord, TourStatus } from './types'

const PREFIX = 'socialcrm:education:v1:'

export function storageKey(userId: number): string {
  return PREFIX + String(userId)
}

export function emptyState(): EducationState {
  return { tours: {} }
}

function isRecord(value: unknown): value is TourRecord {
  if (!value || typeof value !== 'object') return false
  const v = value as TourRecord
  return typeof v.version === 'number' && (v.status === 'completed' || v.status === 'dismissed') && typeof v.at === 'string'
}

export function parseState(raw: string | null): EducationState {
  if (!raw) return emptyState()
  try {
    const parsed = JSON.parse(raw) as { tours?: unknown }
    if (!parsed || typeof parsed !== 'object' || !parsed.tours || typeof parsed.tours !== 'object') {
      return emptyState()
    }
    const tours: EducationState['tours'] = {}
    for (const [id, rec] of Object.entries(parsed.tours)) {
      if (isRecord(rec)) tours[id as TourId] = rec
    }
    return { tours }
  } catch {
    return emptyState()
  }
}

export function readState(userId: number): EducationState {
  if (typeof window === 'undefined') return emptyState()
  try {
    return parseState(window.localStorage.getItem(storageKey(userId)))
  } catch {
    return emptyState()
  }
}

export function writeState(userId: number, state: EducationState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state))
  } catch {
    // Private mode / quota — education must never break the workspace.
  }
}

export function recordTour(
  state: EducationState,
  id: TourId,
  version: number,
  status: TourStatus,
  lastStep?: number,
): EducationState {
  return {
    tours: {
      ...state.tours,
      [id]: {
        version,
        status,
        at: new Date().toISOString(),
        ...(typeof lastStep === 'number' ? { lastStep } : {}),
      },
    },
  }
}
