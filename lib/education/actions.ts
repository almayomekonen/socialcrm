import { getTour, isTourId } from './registry'
import { isTourLockHeld } from './tourLock'
import type { TourId } from './types'

/**
 * Allowlisted Copilot → education actions. The model never chooses a tour id;
 * it can only surface one of these keys, and only the education layer starts a tour.
 */
export const EDUCATION_ACTIONS = {
  open_overview_tour: { tourId: 'overview', href: null },
  open_pipeline_tour: { tourId: 'pipeline', href: '/leads?tour=pipeline&from=copilot' },
  open_lead_tour: { tourId: 'lead', href: null },
  open_copilot_tour: { tourId: 'copilot', href: null },
  open_whatsapp_tour: {
    tourId: 'whatsapp',
    href: '/settings/integrations?section=whatsapp&tour=whatsapp&from=copilot',
  },
  open_facebook_tour: {
    tourId: 'facebook',
    href: '/settings/integrations?section=facebook&tour=facebook&from=copilot',
  },
} as const satisfies Record<string, { tourId: TourId; href: string | null }>

export type EducationActionId = keyof typeof EDUCATION_ACTIONS

export type EducationActionReject = 'invalid' | 'missing' | 'locked' | 'ineligible'

export const EDUCATION_ACTION_EVENT = 'socialcrm:education-action'

export function isEducationActionId(value: unknown): value is EducationActionId {
  return typeof value === 'string' && value in EDUCATION_ACTIONS
}

export function tourIdForAction(action: EducationActionId): TourId {
  return EDUCATION_ACTIONS[action].tourId
}

export function hrefForEducationAction(action: EducationActionId): string | null {
  return EDUCATION_ACTIONS[action].href
}

/** Navigate when the tour's UI lives on another page; otherwise start in place. */
export function navigationHrefForAction(action: EducationActionId, pathname: string): string | null {
  const href = hrefForEducationAction(action)
  if (!href) return null
  const path = href.split('?')[0]
  const onPage = pathname === path || pathname.startsWith(`${path}/`)
  if (onPage && !href.includes('section=')) return null
  return href
}

export function resolveEducationActionRequest(
  raw: unknown,
  opts: { lockHeld: boolean; eligible?: boolean },
): { ok: true; action: EducationActionId; tourId: TourId } | { ok: false; reason: EducationActionReject } {
  if (!isEducationActionId(raw)) return { ok: false, reason: 'invalid' }
  const tourId = tourIdForAction(raw)
  if (!isTourId(tourId) || !getTour(tourId)) return { ok: false, reason: 'missing' }
  if (opts.lockHeld) return { ok: false, reason: 'locked' }
  if (opts.eligible === false) return { ok: false, reason: 'ineligible' }
  return { ok: true, action: raw, tourId }
}

/**
 * Ask the education island to start a tour. Safe to call from Copilot:
 * does not import Driver.js or runTour.
 */
export function requestEducationAction(raw: unknown): boolean {
  if (typeof window === 'undefined') return false
  const resolved = resolveEducationActionRequest(raw, { lockHeld: isTourLockHeld() })
  if (!resolved.ok) return false
  window.dispatchEvent(new CustomEvent(EDUCATION_ACTION_EVENT, { detail: { action: resolved.action } }))
  return true
}
