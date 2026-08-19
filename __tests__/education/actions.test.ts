import { afterEach, describe, expect, it } from 'vitest'
import {
  EDUCATION_ACTIONS,
  hrefForEducationAction,
  isEducationActionId,
  navigationHrefForAction,
  requestEducationAction,
  resolveEducationActionRequest,
  tourIdForAction,
} from '@/lib/education/actions'
import { allTours, getTour } from '@/lib/education/registry'
import { acquireTourLock, __resetTourLockForTests } from '@/lib/education/tourLock'

afterEach(() => {
  __resetTourLockForTests()
})

describe('education action allowlist', () => {
  it('accepts only registered action keys', () => {
    expect(isEducationActionId('open_pipeline_tour')).toBe(true)
    expect(isEducationActionId('open_lead_tour')).toBe(true)
    expect(isEducationActionId('open_copilot_tour')).toBe(true)
    expect(isEducationActionId('open_whatsapp_tour')).toBe(true)
    expect(isEducationActionId('open_facebook_tour')).toBe(true)
    expect(isEducationActionId('open_anything')).toBe(false)
    expect(isEducationActionId('pipeline')).toBe(false)
    expect(isEducationActionId(null)).toBe(false)
  })

  it('maps every action to a tour that exists in the registry', () => {
    const ids = allTours().map((t) => t.id)
    for (const [action, spec] of Object.entries(EDUCATION_ACTIONS)) {
      expect(ids).toContain(spec.tourId)
      expect(tourIdForAction(action as keyof typeof EDUCATION_ACTIONS)).toBe(spec.tourId)
      expect(getTour(spec.tourId)?.id).toBe(spec.tourId)
    }
  })

  it('rejects an invalid action before any tour would start', () => {
    expect(resolveEducationActionRequest('open_anything', { lockHeld: false })).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('rejects when a tour is already running', () => {
    expect(acquireTourLock()).toBe(true)
    expect(resolveEducationActionRequest('open_pipeline_tour', { lockHeld: true })).toEqual({
      ok: false,
      reason: 'locked',
    })
  })

  it('rejects when the caller marks the tour ineligible (entitlement / mobile)', () => {
    expect(
      resolveEducationActionRequest('open_copilot_tour', { lockHeld: false, eligible: false }),
    ).toEqual({ ok: false, reason: 'ineligible' })
  })

  it('accepts a valid action when unlocked and eligible', () => {
    expect(resolveEducationActionRequest('open_pipeline_tour', { lockHeld: false, eligible: true })).toEqual({
      ok: true,
      action: 'open_pipeline_tour',
      tourId: 'pipeline',
    })
  })

  it('navigates to Integrations for WhatsApp, stays on Leads for pipeline, and never routes for overview', () => {
    expect(navigationHrefForAction('open_pipeline_tour', '/leads')).toBeNull()
    expect(navigationHrefForAction('open_pipeline_tour', '/dashboard')).toBe(hrefForEducationAction('open_pipeline_tour'))
    expect(navigationHrefForAction('open_whatsapp_tour', '/settings/integrations')).toContain('section=whatsapp')
    expect(navigationHrefForAction('open_copilot_tour', '/leads')).toBeNull()
    expect(hrefForEducationAction('open_overview_tour')).toBeNull()
    expect(navigationHrefForAction('open_overview_tour', '/leads')).toBeNull()
    expect(navigationHrefForAction('open_overview_tour', '/dashboard')).toBeNull()
  })

  it('does not dispatch on the server', () => {
    expect(typeof window).toBe('undefined')
    expect(requestEducationAction('open_pipeline_tour')).toBe(false)
  })
})
